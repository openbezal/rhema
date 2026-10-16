/** Prepare pinned, validated FP32/INT8 assets without changing the runtime vector contract. */
import {
  EMBEDDING_MINIMUM_PYTHON,
  EMBEDDING_REQUIREMENTS,
  createEmbeddingPlan,
  prepareEmbeddingModels,
} from "./lib/embedding-toolchain"
import { ensurePythonEnv, PROJECT_ROOT } from "./lib/python-env"

async function main() {
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify(createEmbeddingPlan(PROJECT_ROOT), null, 2))
    return
  }
  await ensurePythonEnv(EMBEDDING_REQUIREMENTS, EMBEDDING_MINIMUM_PYTHON)
  const result = await prepareEmbeddingModels({
    force: process.argv.includes("--force"),
  })
  console.log(`FP32 + INT8 structure and SHA-256 checks: ${result.fingerprint}`)
  console.log(
    "Quantization is lossy; see documentation/testing/embedding-toolchain.md for measured limitations."
  )
  console.log(
    "Run bun run setup:all --with-embedding to rebuild/check matching verse embeddings before use."
  )
}

main().catch((error) => {
  console.error("Model preparation failed:", error)
  process.exit(1)
})
