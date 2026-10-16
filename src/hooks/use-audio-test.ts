import { useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useAudioStore } from "@/stores/audio-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { AudioLevel } from "@/types"
import { useTauriEvent } from "./use-tauri-event"
import {
  isOperatorMaintenanceActive,
  isOperatorWorkCurrent,
  operatorRevision,
} from "@/lib/operator-maintenance"

interface AudioTestStoppedPayload {
  reason: "stopped" | "timeout" | "device_lost" | (string & {})
}
let audioActionRevision = 0
let pendingStart: Promise<void> | null = null

export const audioTestActions = {
  start(): Promise<void> {
    if (isOperatorMaintenanceActive()) return Promise.resolve()
    if (pendingStart) return pendingStart
    if (useAudioStore.getState().isTesting) return Promise.resolve()
    const epoch = operatorRevision(),
      revision = ++audioActionRevision
    const current = () =>
      audioActionRevision === revision && isOperatorWorkCurrent(epoch)
    const settings = useSettingsStore.getState()
    useAudioStore.setState({ isTestStarting: true })
    const job = (async () => {
      try {
        await invoke("start_audio_test", {
          deviceId: settings.audioDeviceId,
          gain: settings.gain,
        })
        if (current()) useAudioStore.getState().setTesting(true)
      } catch (e) {
        if (current())
          toast.error("Could not start audio test", { description: String(e) })
      }
    })()
    pendingStart = job
    const finish = () => {
      if (pendingStart === job) {
        pendingStart = null
        useAudioStore.setState({ isTestStarting: false })
      }
    }
    void job.then(finish, finish)
    return job
  },

  async stop(): Promise<void> {
    ++audioActionRevision
    try {
      await invoke("stop_audio_test")
    } catch {
      // Idempotent on the Rust side; a failure here just means there was
      // nothing to stop (e.g. Tauri unavailable during dev).
    }
    const audio = useAudioStore.getState()
    audio.setTesting(false)
    audio.setLevel({ rms: 0, peak: 0 })
  },

  async toggle(): Promise<void> {
    if (
      useAudioStore.getState().isTesting ||
      useAudioStore.getState().isTestStarting
    ) {
      await audioTestActions.stop()
    } else {
      await audioTestActions.start()
    }
  },
}

/**
 * Drives the settings-dialog "Test" button for audio input sources.
 *
 * Starts a capture-only pipeline in Rust (`start_audio_test`) that emits the
 * same `audio_level` events as transcription, so the existing `LevelMeter`
 * component visualizes the source without any STT involved. The test stops
 * when toggled off, when the component unmounts (dialog closed / section
 * changed), when the selected device changes, or when Rust self-stops
 * (60 s timeout or device loss → `audio_test_stopped` event).
 */
export function useAudioTest() {
  const isTesting = useAudioStore((s) => s.isTesting)
  const isStarting = useAudioStore((s) => s.isTestStarting)
  const levelRms = useAudioStore((s) => s.level.rms)
  const audioDeviceId = useSettingsStore((s) => s.audioDeviceId)

  // Keep the store level fresh during a test even if the main screen's
  // audio_level listener isn't mounted.
  useTauriEvent<AudioLevel>("audio_level", (payload) => {
    if (useAudioStore.getState().isTesting) {
      useAudioStore.getState().setLevel(payload)
    }
  })

  // Rust self-stopped the test (timeout, device lost, or preempted by
  // transcription) — sync UI state and explain why when it wasn't the user.
  useTauriEvent<AudioTestStoppedPayload>("audio_test_stopped", ({ reason }) => {
    const audio = useAudioStore.getState()
    audio.setTesting(false)
    audio.setLevel({ rms: 0, peak: 0 })
    if (reason === "timeout") {
      toast.info("Audio test stopped automatically after 60 seconds")
    } else if (reason === "device_lost") {
      toast.warning("Audio device was lost during the test")
    }
  })

  // The capture is bound to the device chosen at start — stop the test when
  // the selection changes so the meter never reflects a stale device.
  useEffect(() => {
    if (
      useAudioStore.getState().isTesting ||
      useAudioStore.getState().isTestStarting
    ) {
      void audioTestActions.stop()
    }
  }, [audioDeviceId])

  // Leak guard: dialog closed or section switched while testing.
  useEffect(
    () => () => {
      if (
        useAudioStore.getState().isTesting ||
        useAudioStore.getState().isTestStarting
      ) {
        void audioTestActions.stop()
      }
    },
    []
  )

  return {
    isTesting,
    isStarting,
    /** RMS level 0..1 while testing; pinned to 0 otherwise. */
    level: isTesting ? levelRms : 0,
    toggle: audioTestActions.toggle,
    stop: audioTestActions.stop,
  }
}
