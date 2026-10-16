import type { BroadcastTrace } from "./broadcast-trace"
export interface CapturedFrame {
  trace?: BroadcastTrace & { renderedEpochMs: number }
  width: number
  height: number
  pixels: Uint8Array
}
export interface DeliveryFrame extends CapturedFrame {
  lease: string
  revision: number
}
interface PendingFrame {
  lease: string
  revision: number
  capture: () => CapturedFrame
}

/** One IPC call and one latest dirty capture per output. Pixels are read only
 * when that revision can be sent; arrival never allocates an unbounded queue.
 */
export class LatestFrameDelivery {
  private lease: string | null = null
  private revision = 0
  private pending: PendingFrame | null = null
  private busy = false
  private retry: ReturnType<typeof setTimeout> | null = null
  private readonly send: (frame: DeliveryFrame) => Promise<void>
  private readonly onError: (error: unknown) => void
  constructor(
    send: (frame: DeliveryFrame) => Promise<void>,
    onError: (error: unknown) => void = () => {}
  ) {
    this.send = send
    this.onError = onError
  }
  activate(lease: string): void {
    if (this.lease === lease) return
    this.stop()
    this.lease = lease
  }
  request(revision: number, capture: () => CapturedFrame): void {
    if (
      !this.lease ||
      !Number.isSafeInteger(revision) ||
      revision <= this.revision
    )
      return
    this.revision = revision
    this.pending = { lease: this.lease, revision, capture }
    this.cancelRetry()
    void this.drain()
  }
  stop(): void {
    this.lease = null
    this.revision = 0
    this.pending = null
    this.cancelRetry()
  }
  private cancelRetry(): void {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }
  private async drain(): Promise<void> {
    if (this.busy || !this.pending || !this.lease) return
    const job = this.pending
    this.pending = null
    this.busy = true
    let failed = false
    try {
      await this.send({
        ...job.capture(),
        lease: job.lease,
        revision: job.revision,
      })
    } catch (error) {
      failed = true
      if (this.lease === job.lease) this.onError(error)
    } finally {
      this.busy = false
      if (this.pending) void this.drain()
      else if (failed && this.lease === job.lease) {
        this.pending = job
        this.retry = setTimeout(() => {
          this.retry = null
          void this.drain()
        }, 100)
      }
    }
  }
}
