"""Small graph fixtures exercise asset checks without downloading model weights."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from tokenizers import Tokenizer, models

sys.path.insert(0, str(Path(__file__).parent / "lib"))
from embedding_assets import inspect_assets  # noqa: E402


class InspectAssetsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def graph(self, *, output: str = "last_hidden_state", cache_input: bool = False) -> None:
        inputs = [
            helper.make_tensor_value_info(name, TensorProto.INT64, ["batch", "sequence"])
            for name in ("input_ids", "attention_mask", "position_ids")
        ]
        if cache_input:
            inputs.append(helper.make_tensor_value_info("past_key_values.0", TensorProto.FLOAT, [1, 2]))
        shape = [1, 2, 1024] if output == "last_hidden_state" else [1, 1024]
        weights = numpy_helper.from_array(np.ones(shape, dtype=np.float32), name="weights")
        graph = helper.make_graph(
            [helper.make_node("Identity", ["weights"], [output])],
            "fixture",
            inputs,
            [helper.make_tensor_value_info(output, TensorProto.FLOAT, shape)],
            [weights],
        )
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)])
        onnx.save_model(
            model,
            self.directory / "model.onnx",
            save_as_external_data=True,
            all_tensors_to_one_file=True,
            location="model.onnx_data",
            size_threshold=0,
        )
        Tokenizer(models.WordLevel({"[UNK]": 0}, unk_token="[UNK]")).save(str(self.directory / "tokenizer.json"))

    def inspect(self) -> dict:
        return inspect_assets(self.directory, "model.onnx")

    def test_complete_external_graph_has_stable_fingerprint(self) -> None:
        self.graph()
        report = self.inspect()
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["fingerprint"], self.inspect()["fingerprint"])
        self.assertEqual(report["outputs"], {"last_hidden_state": [1, 2, 1024]})

    def test_missing_external_data_is_not_a_completed_model(self) -> None:
        self.graph()
        (self.directory / "model.onnx_data").unlink()
        self.assertFalse(self.inspect()["valid"])

    def test_truncated_external_data_is_not_a_completed_model(self) -> None:
        self.graph()
        (self.directory / "model.onnx_data").write_bytes(b"truncated")
        self.assertFalse(self.inspect()["valid"])

    def test_external_path_escape_is_rejected_before_reading_it(self) -> None:
        self.graph()
        model = onnx.load(self.directory / "model.onnx", load_external_data=False)
        for entry in model.graph.initializer[0].external_data:
            if entry.key == "location":
                entry.value = "../outside.data"
        onnx.save_model(model, self.directory / "model.onnx")
        self.assertFalse(self.inspect()["valid"])

    def test_prepooled_export_requires_a_separate_migration(self) -> None:
        self.graph(output="sentence_embedding")
        self.assertFalse(self.inspect()["valid"])

    def test_text_generation_cache_inputs_are_rejected(self) -> None:
        self.graph(cache_input=True)
        self.assertFalse(self.inspect()["valid"])

    def test_malformed_tokenizer_is_rejected(self) -> None:
        self.graph()
        (self.directory / "tokenizer.json").write_text(json.dumps({"model": "broken"}))
        self.assertFalse(self.inspect()["valid"])

    def test_weight_mutation_changes_the_fingerprint(self) -> None:
        self.graph()
        before = self.inspect()["fingerprint"]
        data = self.directory / "model.onnx_data"
        data.write_bytes(np.full((1, 2, 1024), 2.0, dtype=np.float32).tobytes())
        report = self.inspect()
        self.assertTrue(report["valid"], report)
        self.assertNotEqual(before, report["fingerprint"])


if __name__ == "__main__":
    unittest.main()
