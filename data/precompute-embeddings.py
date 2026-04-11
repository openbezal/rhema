#!/usr/bin/env python3
"""
Pre-compute verse embeddings for Rhema.

Automatically picks the fastest available backend:
  1. sentence-transformers + GPU (MPS/CUDA) — fastest
  2. sentence-transformers + CPU — medium
  3. ONNX Runtime (local model) — fallback if torch not installed

Outputs match the Rust binary format expected by HnswVectorIndex::load():
  - embeddings file: flat f32 array, little-endian, dim floats per verse
  - ids file: flat i64 array, little-endian, one per verse

Usage:
  python3 data/precompute-embeddings.py

Requires (one of):
  pip install sentence-transformers torch numpy   (GPU path)
  pip install onnxruntime tokenizers numpy         (ONNX fallback)
"""

import json
import time
import sys
from pathlib import Path

import numpy as np

# ── Paths ───────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
VERSES_PATH = ROOT / "data" / "verses-for-embedding.json"
EMB_OUT = ROOT / "embeddings" / "kjv-qwen3-0.6b.bin"
IDS_OUT = ROOT / "embeddings" / "kjv-qwen3-0.6b-ids.bin"
MODEL_NAME = "Qwen/Qwen3-Embedding-0.6B"

# ONNX model paths (for fallback)
MODEL_INT8 = ROOT / "models" / "qwen3-embedding-0.6b-int8" / "model_quantized.onnx"
MODEL_FP32 = ROOT / "models" / "qwen3-embedding-0.6b" / "model.onnx"
TOKENIZER_PATH = ROOT / "models" / "qwen3-embedding-0.6b" / "tokenizer.json"

MAX_LENGTH = 128
BATCH_SIZE_ONNX = 32
BATCH_SIZE_GPU = 64


def encode_with_sentence_transformers(texts):
    """Encode using sentence-transformers (GPU-accelerated if available)."""
    import torch
    from sentence_transformers import SentenceTransformer

    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    print(f"Backend: sentence-transformers ({device})")
    print(f"Model:   {MODEL_NAME}")

    print(f"\nLoading model (may download on first run)...")
    model = SentenceTransformer(MODEL_NAME, device=device)
    dim = model.get_embedding_dimension()
    print(f"  Embedding dimension: {dim}")

    print(f"\nEncoding {len(texts)} verses...")
    t0 = time.time()
    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE_GPU,
        show_progress_bar=True,
        normalize_embeddings=True,
    )
    elapsed = time.time() - t0
    print(f"  Done in {elapsed:.1f}s ({len(texts) / elapsed:.0f} verses/sec)")

    return np.asarray(embeddings, dtype=np.float32)


def encode_with_onnx(texts):
    """Encode using ONNX Runtime (CPU, uses local exported model)."""
    import onnxruntime as ort
    from tokenizers import Tokenizer

    # Select model
    if MODEL_INT8.exists():
        model_path = MODEL_INT8
        print(f"Backend: ONNX Runtime (INT8 quantized)")
    elif MODEL_FP32.exists():
        model_path = MODEL_FP32
        print(f"Backend: ONNX Runtime (FP32)")
    else:
        print(f"ERROR: No ONNX model found at {MODEL_INT8} or {MODEL_FP32}")
        sys.exit(1)

    print(f"Model:   {model_path}")

    # Load tokenizer
    tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
    tokenizer.enable_truncation(max_length=MAX_LENGTH)
    tokenizer.enable_padding(length=MAX_LENGTH)

    # Load ONNX model
    print(f"Loading ONNX model...")
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(str(model_path), sess_options)

    output_names = [o.name for o in session.get_outputs()]
    has_sentence_embedding = "sentence_embedding" in output_names
    input_names = [i.name for i in session.get_inputs()]
    has_position_ids = "position_ids" in input_names

    if has_sentence_embedding:
        print("  Using 'sentence_embedding' output (pre-pooled)")
    else:
        print("  Using mean pooling on last_hidden_state")

    # Process in batches
    print(f"\nEncoding {len(texts)} verses in batches of {BATCH_SIZE_ONNX}...")
    all_embeddings = []
    t0 = time.time()

    for batch_start in range(0, len(texts), BATCH_SIZE_ONNX):
        batch_end = min(batch_start + BATCH_SIZE_ONNX, len(texts))
        batch_texts = texts[batch_start:batch_end]

        encodings = tokenizer.encode_batch(batch_texts)
        input_ids = np.array([e.ids for e in encodings], dtype=np.int64)
        attention_mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)

        feeds = {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
        }

        if has_position_ids:
            seq_len = input_ids.shape[1]
            position_ids = np.broadcast_to(
                np.arange(seq_len, dtype=np.int64).reshape(1, -1),
                input_ids.shape,
            ).copy()
            feeds["position_ids"] = position_ids

        if has_sentence_embedding:
            outputs = session.run(["sentence_embedding"], feeds)
            embeddings = outputs[0]
        else:
            outputs = session.run(None, feeds)
            hidden = outputs[0]
            mask_expanded = attention_mask[:, :, np.newaxis].astype(np.float32)
            embeddings = (hidden * mask_expanded).sum(axis=1) / mask_expanded.sum(axis=1)

        # L2 normalize
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.maximum(norms, 1e-12)
        embeddings = embeddings / norms

        all_embeddings.append(embeddings.astype(np.float32))

        done = batch_end
        if done % (BATCH_SIZE_ONNX * 10) == 0 or done == len(texts):
            elapsed = time.time() - t0
            rate = done / elapsed if elapsed > 0 else 0
            remaining = (len(texts) - done) / rate if rate > 0 else 0
            print(f"  {done}/{len(texts)} ({rate:.0f} verses/sec, ~{remaining/60:.0f} min remaining)", flush=True)

    elapsed = time.time() - t0
    print(f"  Done in {elapsed:.1f}s ({len(texts) / elapsed:.0f} verses/sec)")

    return np.concatenate(all_embeddings, axis=0)


def main():
    print(f"\n=== Rhema Verse Embedding Pre-computation ===")

    # Load verses
    print(f"\nLoading verses from {VERSES_PATH}...")
    with open(VERSES_PATH) as f:
        entries = json.load(f)
    print(f"  {len(entries)} verses loaded")

    ids = [e["id"] for e in entries]
    texts = [e["text"] for e in entries]

    # Try GPU path first, fall back to ONNX
    try:
        import torch
        all_embeddings = encode_with_sentence_transformers(texts)
    except ImportError:
        print("  torch not available, falling back to ONNX Runtime...")
        all_embeddings = encode_with_onnx(texts)

    dim = all_embeddings.shape[1]
    print(f"  Embedding dimension: {dim}")

    # Write embeddings binary (flat f32, little-endian)
    EMB_OUT.parent.mkdir(parents=True, exist_ok=True)
    print(f"\nWriting embeddings to {EMB_OUT}...")
    emb_array = np.ascontiguousarray(all_embeddings, dtype="<f4")
    emb_array.tofile(str(EMB_OUT))
    emb_size = EMB_OUT.stat().st_size
    print(f"  {emb_size:,} bytes ({emb_size / 1024 / 1024:.1f} MB)")

    # Write IDs binary (flat i64, little-endian)
    print(f"Writing IDs to {IDS_OUT}...")
    ids_array = np.array(ids, dtype="<i8")
    ids_array.tofile(str(IDS_OUT))
    ids_size = IDS_OUT.stat().st_size
    print(f"  {ids_size:,} bytes")

    # Verify
    expected_emb = len(entries) * dim * 4
    expected_ids = len(entries) * 8
    assert emb_size == expected_emb, f"Embedding size mismatch: {emb_size} != {expected_emb}"
    assert ids_size == expected_ids, f"IDs size mismatch: {ids_size} != {expected_ids}"

    print(f"\n=== Done! {len(entries)} verses x {dim} dims ===\n")


if __name__ == "__main__":
    main()
