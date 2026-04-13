import { invoke } from "@tauri-apps/api/core"
import type { PredictionResult } from "@/types"
import { useState, useCallback } from "react"

async function predictNextVerses(limit?: number) {
  const results = await invoke<PredictionResult[]>("predict_next_verses", {
    limit,
  })
  return results
}

export function usePrediction() {
  const [predictions, setPredictions] = useState<PredictionResult[]>([])
  const [loading, setLoading] = useState(false)

  const fetchPredictions = useCallback(async (limit = 5) => {
    setLoading(true)
    try {
      const results = await predictNextVerses(limit)
      setPredictions(results)
      return results
    } finally {
      setLoading(false)
    }
  }, [])

  const clearPredictions = useCallback(() => {
    setPredictions([])
  }, [])

  return {
    predictions,
    loading,
    fetchPredictions,
    clearPredictions,
  }
}
