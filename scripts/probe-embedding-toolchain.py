"""Compare a real pinned checkpoint/export/quantization using the runtime contract.

Run in the pinned ML environment. This is a local full-model probe, separate
from the small, network-free CI graph fixtures. Output includes reference
vectors consumed by the companion Rust example.
"""

import argparse
import json
import platform
import sys
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
import torch
from tokenizers import Tokenizer
from transformers import AutoModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data/lib"))
from embedding_assets import file_digest, inspect_assets  # noqa: E402

TEXTS = [
    "For God so loved the world, that he gave his only begotten Son.",
    "The LORD is my shepherd; I shall not want.",
    "Ọlọ́run fẹ́ ayé. Chineke hụrụ ụwa n’anya. Allah yana ƙaunar duniya.",
    "Long input for truncation. " * 160,
]


def pooled(hidden: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Match runtime masked mean followed by L2 normalization."""
    weights = mask[:, :, None].astype(np.float32)
    result = (hidden * weights).sum(axis=1) / weights.sum(axis=1)
    return result / np.linalg.norm(result, axis=1, keepdims=True)


def tokenize(path: Path, texts: list[str]) -> dict[str, np.ndarray]:
    """Match raw Rust tokenizers, right padding at ID zero and 128 tokens."""
    tokenizer = Tokenizer.from_file(str(path))
    tokenizer.enable_padding(length=128, pad_id=0, pad_token=tokenizer.id_to_token(0) or "[PAD]")
    tokenizer.enable_truncation(max_length=128)
    encodings = tokenizer.encode_batch(texts, add_special_tokens=True)
    ids = np.array([encoding.ids for encoding in encodings], dtype=np.int64)
    return {
        "input_ids": ids,
        "attention_mask": np.array([encoding.attention_mask for encoding in encodings], dtype=np.int64),
        "position_ids": np.broadcast_to(np.arange(128, dtype=np.int64), ids.shape).copy(),
    }


def main() -> None:
    """Write numerical results, source hashes and cross-language reference vectors."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--fp32", type=Path, required=True)
    parser.add_argument("--int8", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    torch.set_num_threads(4)
    torch.set_num_interop_threads(2)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 2
    reports = {
        "fp32": inspect_assets(args.fp32, "model.onnx"),
        "int8": inspect_assets(args.int8, "model_quantized.onnx"),
    }
    if not all(report["valid"] for report in reports.values()):
        raise ValueError(reports)
    model = AutoModel.from_pretrained(args.source, torch_dtype=torch.float32, local_files_only=True)
    model.eval()
    feeds = tokenize(args.fp32 / "tokenizer.json", TEXTS)
    sessions = {
        "fp32": ort.InferenceSession(str(args.fp32 / "model.onnx"), options, providers=["CPUExecutionProvider"]),
        "int8": ort.InferenceSession(
            str(args.int8 / "model_quantized.onnx"), options, providers=["CPUExecutionProvider"]
        ),
    }
    checks: list[dict[str, Any]] = []
    references: dict[str, list[list[float]]] = {}
    for batch, length in [(1, 1), (1, 32), (2, 128), (4, 128)]:
        sample = {name: value[:batch, :length].copy() for name, value in feeds.items()}
        with torch.inference_mode():
            torch_hidden = model(
                **{name: torch.from_numpy(value) for name, value in sample.items()}
            ).last_hidden_state.numpy()
        expected = pooled(torch_hidden, sample["attention_mask"])
        for name, session in sessions.items():
            hidden = session.run(["last_hidden_state"], sample)[0]
            actual = pooled(hidden, sample["attention_mask"])
            cosines = np.sum(expected * actual, axis=1)
            active = sample["attention_mask"].astype(bool)
            check = {
                "model": name,
                "shape": [batch, length],
                "outputShape": list(hidden.shape),
                "finite": bool(np.isfinite(hidden).all()),
                "activeHiddenMaxAbsDifference": float(np.max(np.abs(torch_hidden[active] - hidden[active]))),
                "pooledCosines": cosines.tolist(),
                "norms": np.linalg.norm(actual, axis=1).tolist(),
            }
            checks.append(check)
            if batch == 4:
                # Rust precompute and runtime embed one verse/query at a time.
                # Dynamic activation quantization may vary with batch contents.
                references[name] = [
                    pooled(
                        session.run(
                            ["last_hidden_state"], {key: value[index : index + 1] for key, value in sample.items()}
                        )[0],
                        sample["attention_mask"][index : index + 1],
                    )[0].tolist()
                    for index in range(4)
                ]
            print(json.dumps(check), flush=True)
    result = {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "versions": {
            package: version(package)
            for package in [
                "optimum",
                "optimum-onnx",
                "transformers",
                "sentence-transformers",
                "torch",
                "onnx",
                "onnxruntime",
                "tokenizers",
                "accelerate",
                "numpy",
                "huggingface-hub",
            ]
        },
        "source": {
            name: file_digest(args.source / name) for name in ["model.safetensors", "config.json", "tokenizer.json"]
        },
        "assets": reports,
        "checks": checks,
        "texts": TEXTS,
        "vectors": references,
        "contract": {"maxTokens": 128, "pooling": "masked-mean", "prefix": "", "padId": 0},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    # These are compatibility smoke gates, not a corpus retrieval quality claim.
    if not all(
        check["finite"] and min(check["pooledCosines"]) >= (0.9999 if check["model"] == "fp32" else 0.95)
        for check in checks
    ):
        raise SystemExit("Numerical compatibility smoke threshold failed; retain the report before changing anything")


if __name__ == "__main__":
    main()
