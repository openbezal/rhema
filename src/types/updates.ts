/** Result of asking the backend whether a newer release is published. */
export interface UpdateStatus {
  /** The running app's version. */
  current: string
  /** Newest published release, without the `v` prefix. */
  latest: string
  /** Release page to send the operator to. */
  url: string
  /** Whether `latest` is actually ahead of `current`. */
  isNewer: boolean
}
