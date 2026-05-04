import { create } from "zustand"
import type { DeviceInfo, AudioLevel } from "@/types"

interface AudioState {
  devices: DeviceInfo[]
  selectedDeviceId: string | null
  isCapturing: boolean
  gain: number
  level: AudioLevel
  sourceLost: boolean

  setDevices: (devices: DeviceInfo[]) => void
  selectDevice: (id: string | null) => void
  setCapturing: (capturing: boolean) => void
  setGain: (gain: number) => void
  setLevel: (level: AudioLevel) => void
  setSourceLost: (lost: boolean) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  devices: [],
  selectedDeviceId: null,
  isCapturing: false,
  gain: 1.0,
  level: { rms: 0, peak: 0 },
  sourceLost: false,

  setDevices: (devices) => set({ devices }),
  selectDevice: (selectedDeviceId) => set({ selectedDeviceId }),
  setCapturing: (isCapturing) => set({ isCapturing }),
  setGain: (gain) => set({ gain }),
  setLevel: (level) => set({ level }),
  setSourceLost: (sourceLost) => set({ sourceLost }),
}))
