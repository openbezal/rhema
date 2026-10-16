export type NdiResolution = "r720p" | "r1080p" | "r4k"
export type NdiFrameRate = "fps24" | "fps30" | "fps60"
export type NdiAlphaMode = "noneOpaque" | "straightAlpha" | "premultipliedAlpha"

export interface NdiStartRequest {
  sourceName: string
  resolution: NdiResolution
  frameRate: NdiFrameRate
  alphaMode: NdiAlphaMode
}

export interface NdiSessionInfo {
  generation: string
  frameProtocol: number
  sourceName: string
  resolution: NdiResolution
  frameRate: NdiFrameRate
  alphaMode: NdiAlphaMode
  width: number
  height: number
  fps: number
}

export interface NdiFrameStats {
  active: boolean
  epoch: number
  submitted: number
  coalesced: number
  duplicates: number
  rejected: number
  sent: number
  repeated: number
  lastSentEpoch: number
  lastSentRevision: number
  lastSendDurationUs: number
  lastReceivedMs: number
  lastSentMs: number
  lastError: string | null
}
export interface NdiStatus {
  active: boolean
  width: number
  height: number
  fps: number
  generation: string
  frameProtocol: number
  stats: NdiFrameStats
}
export interface NdiRendererLease {
  lease: string
  width: number
  height: number
  fps: number
}

export interface NdiConfigEventPayload {
  active: boolean
  fps: number
  width: number
  height: number
}
