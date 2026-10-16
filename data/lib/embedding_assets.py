"""Fetch a pinned public checkpoint and validate Rhema's existing ONNX contract."""

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any


def file_digest(path: Path) -> str:
    """Hash an asset without loading large model weights into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_assets(directory: Path, filename: str) -> dict[str, Any]:
    """Validate token output, tokenizer and bounded external weights; report hashes."""
    import onnx
    from onnx import TensorProto
    from tokenizers import Tokenizer

    try:
        directory = directory.resolve()
        path = directory / filename
        model = onnx.load(path, load_external_data=False)
        inputs = {value.name: value for value in model.graph.input}
        if set(inputs) != {"input_ids", "attention_mask", "position_ids"}:
            raise ValueError("Expected input_ids, attention_mask and position_ids; no KV cache inputs")
        for value in inputs.values():
            tensor = value.type.tensor_type
            if tensor.elem_type != TensorProto.INT64 or len(tensor.shape.dim) != 2:
                raise ValueError("Expected rank-2 int64 model inputs")
        outputs = {value.name: value for value in model.graph.output}
        if set(outputs) != {"last_hidden_state"}:
            raise ValueError("Expected last_hidden_state token output; prepooled models need an index migration")
        output = outputs["last_hidden_state"].type.tensor_type
        if output.elem_type != TensorProto.FLOAT or len(output.shape.dim) != 3 or output.shape.dim[2].dim_value != 1024:
            raise ValueError("Expected rank-3 float token output with dimension 1024")

        files = {filename: file_digest(path)}
        # Includes tensors in nested graph attributes as well as graph initializers.
        for tensor in onnx.external_data_helper._get_all_tensors(model):
            if tensor.data_location != TensorProto.EXTERNAL:
                continue
            external = {entry.key: entry.value for entry in tensor.external_data}
            location = external.get("location", "")
            relative = Path(location)
            target = (directory / relative).resolve()
            if not location or relative.is_absolute() or not target.is_relative_to(directory):
                raise ValueError("External tensor must stay inside the model directory")
            offset = int(external.get("offset", "0"))
            if tensor.data_type == TensorProto.STRING or any(dimension < 0 for dimension in tensor.dims):
                raise ValueError("Unsupported external tensor storage type/dimensions")
            elements = math.prod(tensor.dims)
            packed = tensor.data_type in {TensorProto.INT4, TensorProto.UINT4, TensorProto.FLOAT4E2M1}
            required = (
                (elements + 1) // 2
                if packed
                else elements * onnx.helper.tensor_dtype_to_np_dtype(tensor.data_type).itemsize
            )
            length = int(external["length"]) if "length" in external else required
            size = target.stat().st_size
            if offset < 0 or length != required or size < offset + required:
                raise ValueError(f"Incomplete external weights: {location}")
            if location not in files:
                files[location] = file_digest(target)

        Tokenizer.from_file(str(directory / "tokenizer.json"))
        files["tokenizer.json"] = file_digest(directory / "tokenizer.json")
        onnx.checker.check_model(str(path))
        fingerprint = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
        shapes = {
            name: [dim.dim_value or dim.dim_param for dim in value.type.tensor_type.shape.dim]
            for name, value in outputs.items()
        }
        return {"valid": True, "fingerprint": fingerprint, "files": files, "outputs": shapes}
    except Exception as error:
        # Tokenizers and protobuf expose native exception classes. An inspection
        # failure never turns a partial graph into a completed installation.
        return {"valid": False, "reason": str(error)}


def snapshot(model_id: str, revision: str) -> Path:
    """Resolve an immutable public checkpoint without sending a saved HF token."""
    from huggingface_hub import snapshot_download

    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("A full immutable checkpoint commit is required")
    path = snapshot_download(
        repo_id=model_id,
        revision=revision,
        token=False,
        allow_patterns=["*.json", "*.safetensors", "merges.txt", "vocab.json", "*.jinja"],
    )
    return Path(path)


def main() -> None:
    """Print one JSON response; downstream tools keep their progress on stderr."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    download = commands.add_parser("snapshot")
    download.add_argument("--model-id", required=True)
    download.add_argument("--revision", required=True)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--directory", type=Path, required=True)
    inspect.add_argument("--filename", choices=["model.onnx", "model_quantized.onnx"], required=True)
    args = parser.parse_args()
    if args.command == "snapshot":
        print(json.dumps({"path": str(snapshot(args.model_id, args.revision))}))
    else:
        print(json.dumps(inspect_assets(args.directory, args.filename)))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Embedding assets failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
