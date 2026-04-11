"""
Direct ONNX export for Qwen3-Embedding-0.6B using PyTorch.
Bypasses optimum-cli to avoid transformers version conflicts.
"""
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModel

MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
PROJECT_ROOT = Path(__file__).parent.parent
OUTPUT_DIR = PROJECT_ROOT / "models" / "qwen3-embedding-0.6b"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

print(f"\n🧠 Loading {MODEL_ID}...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModel.from_pretrained(MODEL_ID, torch_dtype=torch.float32, attn_implementation="eager")
model.eval()

# Wrapper to control inputs and prevent DynamicCache in ONNX export
class EmbeddingWrapper(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask):
        outputs = self.model(input_ids=input_ids, attention_mask=attention_mask, use_cache=False)
        return outputs.last_hidden_state

wrapped = EmbeddingWrapper(model)

# Save tokenizer
print("  Saving tokenizer...")
tokenizer.save_pretrained(OUTPUT_DIR)

# Create dummy input for tracing
print("  Tracing model for ONNX export...")
dummy_text = "This is a sample sentence for tracing."
inputs = tokenizer(dummy_text, return_tensors="pt", padding=True, truncation=True, max_length=512)
input_ids = inputs["input_ids"]
attention_mask = inputs["attention_mask"]

onnx_path = OUTPUT_DIR / "model.onnx"

with torch.no_grad():
    torch.onnx.export(
        wrapped,
        (input_ids, attention_mask),
        str(onnx_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            "input_ids": {0: "batch_size", 1: "sequence_length"},
            "attention_mask": {0: "batch_size", 1: "sequence_length"},
            "last_hidden_state": {0: "batch_size", 1: "sequence_length"},
        },
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

print(f"\n✅ Model exported to {onnx_path}")
print(f"   Size: {onnx_path.stat().st_size / 1e9:.2f} GB")

# Quantize to INT8
print("\n⚡ Quantizing to INT8...")
try:
    from onnxruntime.quantization import quantize_dynamic, QuantType
    int8_path = PROJECT_ROOT / "models" / "qwen3-embedding-0.6b-int8" / "model_quantized.onnx"
    int8_path.parent.mkdir(parents=True, exist_ok=True)
    quantize_dynamic(str(onnx_path), str(int8_path), weight_type=QuantType.QInt8)
    print(f"✅ INT8 model saved to {int8_path}")
    print(f"   Size: {int8_path.stat().st_size / 1e9:.2f} GB")
except Exception as e:
    print(f"⚠️  Quantization failed (FP32 model still usable): {e}")

print("\nDone.")
