# Embedding setup: compatible commands and measured limits

Fresh implementation on our release-notice draft #210. No original PR implementation was copied. This addresses the setup-command defect discussed in #173, keeps the current runtime vector contract, and records why broader model-quality acceptance remains open. No original PR or issue is closed or merged.

**Draft acceptance status:** command construction, pinned source resolution, full export/quantize, integrity checks and same-native-embedder retrieval were exercised. Numerical fidelity checks FAILED for INT8; they are retained below. Do not treat successful setup or the small retrieval fixture as a full-corpus quality acceptance. Keep this draft out of a release until that acceptance decision is recorded.

## Command and reuse boundary

Both `download:model` and `setup:all --with-embedding` share one plan and implementation. `--plan` prints the exact command arrays and toolchain without initializing Python, downloading weights or changing assets. `quantize:model` now aliases the same validated model workflow instead of selecting an unpinned global executable; use `--force` to rebuild, including export.

The supported export remains `feature-extraction`, explicit `--library-name transformers`, FP32, opset 18, example batch 1 / sequence 128. Only the quantize command loses the unsupported `--library-name` argument. The existing ARM64 dynamic INT8 recipe is retained; neither the per-channel nor weight-only experiments below were adopted. Argument arrays preserve paths with spaces without shell interpolation.

The shared Python setup accepts a caller-specific minimum, skips installed but too-old candidates, and verifies an existing venv before installing packages. Embedding setup requires Python 3.11 because of the selected NumPy/runtime versions; unrelated callers retain their 3.9 default. Eleven directly used packages are pinned in `data/embedding-toolchain.json`. These are top-level pins, not a complete transitive lock or a hermetic environment. The actual full-model run used the already installed matching packages in a read-only Python 3.14.7 environment; it did not run pip or alter that environment.

The source is the official public checkpoint at immutable commit `c54f2e6e80b2d7b7de06f51cec4959f6b3e03418`. A helper resolves that snapshot with `token=False`; export uses its local path. No remote model code is enabled. ONNX checks require the three rank-2 int64 inputs, rank-3 float `last_hidden_state` output of dimension 1024, a loadable tokenizer, valid ONNX structure and complete external tensor files within the model directory. SHA-256 covers graph, tokenizer and referenced weight files. An existing header with missing external weights is incomplete even if `model.onnx` exists.

A destination lock refuses overlapping preparations. A crash leaves a stale lock for explicit inspection rather than guessing that another process has finished. Both outputs are built in a sibling staging directory and inspected before publication; failed export, quantization or inspection retains the previous pair and receipt. Publication uses rename/rollback, with backups retained if rollback fails. It is not a power-loss-atomic multi-directory transaction. Run developer setup with Rhema closed.

Model reuse requires matching toolchain and asset fingerprints. An old installation without a receipt is rebuilt. Verse JSON is refreshed from the current database before index reuse. Index reuse requires matching model fingerprint, verse JSON hash, vector binary hash and ID binary hash. Rust precompute writes both files using the same production `OnnxEmbedder` used for queries. Standalone model setup does not regenerate an older index: run `bun run setup:all --with-embedding` before using the changed assets in the app.

## Why export selection remains explicit

[Optimum's official export guide](https://huggingface.co/docs/optimum-onnx/onnx/usage_guides/export_a_model) documents export-library selection and inference. At this checkpoint automatic selection can choose the Sentence Transformers module, whose pooling configuration selects the last token. Rhema's existing token-output path uses masked mean, right padding with ID zero, 128-token truncation, no prompt prefix and L2 normalization. Changing only export selection can therefore change the vector space used with existing indexes.

The [pinned official model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B/blob/c54f2e6e80b2d7b7de06f51cec4959f6b3e03418/README.md) demonstrates last-token pooling, left padding and query instructions. This draft deliberately preserves Rhema's existing convention; it does not claim the model card's retrieval quality. A convention migration requires an explicit model/index regeneration and a representative full-corpus comparison.

Main's earlier revert `ccb7ccbeda4e4781fe5aa1424ea11b1650a00001` (#162) restored the library argument to both commands when reverting #161. Its recorded explanation establishes the revert, not a measured quality reason. The installed supported CLI independently reproduced quantize's unrecognized-argument failure (exit 2). That result does not justify removing a valid export option.

## Full-model evidence and failures

All generated model files were isolated in a temporary directory. The user's existing FP32 header, incomplete external data and existing INT8 assets were read only and were not repaired or replaced. The production workflow used an isolated temporary root, copied helper/manifest and a read-only link to the matching existing venv. It exported, quantized, checked and published the pair; a repeat returned `changed:false` and the same fingerprint. Its output fingerprints matched the earlier independent export/quantize experiment.

The exporter returned exit 0 **with warnings**, including deprecated `torch_dtype`, mask/SDPA boolean tracing, advanced indexing, and a reference-vs-ONNX hidden-state max difference above its `1e-5` tolerance: `0.0006999969482421875` in the first export and `0.0009632110595703125` in the shared workflow. Quantization also emitted a Transformers tokenizer-regex warning. None is suppressed. The numerical probe uses the raw tokenizers file, matching Rust; FP32 pooled cosine against the PyTorch checkpoint was 0.99999994–1.0 over tested batch/length shapes, while active hidden-state max difference reached 0.0006809234619140625. This is not exact tensor equality.

The local numerical probe has an explicit FP32 cosine gate of 0.9999 and INT8 gate of 0.95. It saves results before returning nonzero. Minimum pooled cosine against PyTorch by shape:

| Recipe | 1 × 1 | 1 × 32 | 2 × 128 | 4 × 128 |
| --- | ---: | ---: | ---: | ---: |
| Existing dynamic ARM64 | 0.535273 | 0.897094 | 0.790923 | 0.801766 |
| Dynamic ARM64, per channel experiment | 0.833186 | 0.912479 | 0.760674 | 0.810693 |
| Weight-only 8-bit, block 32 experiment | 0.892717 | 0.998847 | 0.998477 | 0.998477 |
| Weight-only 8-bit, block 16 experiment | 0.924508 | 0.999246 | 0.998771 | 0.998771 |

**Every INT8 recipe failed the unchanged gate.** Weight-only experiments used ONNX Runtime's `MatMulNBitsQuantizer`, symmetric 8-bit constant MatMul weights, FP32 activations, accuracy level 4, QOperator and the stated block size. The isolated extra dependency was `onnx-ir==0.2.1`; the first attempt failed visibly because it was absent. These experiments are not a new production format. [ONNX Runtime's quantization documentation](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html) explains that quantization is lossy and must be measured. The old unsupported “>99% embedding quality” claim is removed.

The companion Rust example loads both actual ONNX models through the production embedder, checks finite 1024-dimensional normalized vectors, compares Python references, writes a 65-verse KJV subset through production precompute, reloads the actual binary index and runs 15 queries. All eight exact and seven paraphrase queries ranked their intended verse first, including adjacent John 3:16 / 3:17. This is a deliberately small smoke set with nearby distractors, not a full-corpus benchmark. Index generation and queries use the same Rust instance and recipe.

FP32 Rust/Python comparisons passed (cosine above 0.999999999999). INT8 comparisons FAILED the 0.99999 compatibility threshold even after using single-item Python references (cosines about 0.9651–0.9982); earlier batch-4 references differed more. Root cause of the cross-runtime difference is not isolated. The report keeps `comparisonPassed`, `retrievalPassed` and overall acceptance separate, returns nonzero, and retains all observations. This supports keeping precompute in Rust; it does not establish cross-runtime interchangeability or high quantized fidelity. Neither model nor pooling/index format is silently migrated here.

Compact numeric reports, exact query/verse fixtures, hashes and warning logs are in `fixtures/embedding-toolchain/`. Reference vectors are omitted from compact reports; regenerate them with `scripts/probe-embedding-toolchain.py` for the Rust comparison. Actual full-model execution is separate from CI, which uses tiny synthetic graph fixtures without downloading weights or importing Torch.

## Verification and remaining acceptance

Before independent review: 13 focused tooling tests and eight actual small ONNX graph tests pass. The complete frontend/data suite passes 1,066 tests in 93 files. Typecheck, intentional-error probe, zero-warning lint, production build and both native configurations (498 tests each on macOS) pass. Strict workspace/all-target Clippy and all-feature/all-target detection-tool Clippy pass. The optional tooling gate fixes existing precompute/search benchmark lint failures and is added to native CI alongside the small Python fixtures. The production build retains the existing large-chunk advisory.

The first TypeScript suite failed because the shared module did not exist; its next import exposed Bun-only `import.meta.dir` under Vitest. Standard `fileURLToPath` now supports both runtimes. The Python graph suite first failed because its helper did not exist, then passed. The real simultaneous-build regression failed because the second writer succeeded; the lock fixed it. Tests cover command wiring, spaces, minimum/interpreter/venv behavior, matching and changed/missing receipts, corrupt/partial assets, source/index mutation, failed export/quantization retention and successful commands that leave incomplete files.

Remaining: full-corpus quality, a decision on the failed quantization/cross-runtime thresholds, last-token/instruction migration if adopted, complete ML export/load on Windows/Linux, installed-package asset loading and the wider provider/receiver acceptance. This draft does not resolve those checks or declare the whole backlog complete.

## Design rulings and costs

1. Keep explicit Transformers token export and the current legacy pooling contract. Cost: this does not adopt Qwen's documented optimal convention; migration needs new indexes and quality evidence.
2. Keep the existing dynamic ARM64 recipe while documenting every failed numerical comparison; do not promote an experimental format just because ordinary-text results improve. Cost: quantized fidelity and full-corpus acceptance remain open, and this PR remains a draft.
3. Pin directly used tools and immutable source, with embedding-only Python 3.11 minimum. Cost: unsupported interpreter/wheel combinations fail setup; transitive dependencies are not fully locked.
4. Rebuild assets lacking a trusted receipt and regenerate indexes whose model/source/binary hashes differ. Cost: the first opted-in setup may repeat expensive export and full-corpus precompute.
5. Stage both model directories and serialize writers. Cost: extra disk during generation, manual stale-lock recovery after a crash, and no claimed multi-directory power-loss atomicity.
6. Keep index generation in the production Rust implementation. Cost: a Rust toolchain/full precompute is required; older Python batch-generated vectors are not accepted as proof of the same native space.
7. Separate tiny CI fixtures from local full-model experiments. Cost: cross-platform CI alone cannot approve production-model numerical or retrieval quality.
8. Keep installed acceptance and original issue/PR disposition separate. Cost: passing code gates does not authorize or establish release readiness.

## Independent review

Pending one fresh whole-branch review; findings, the single fix pass and final verification will be recorded here before publishing our draft.
