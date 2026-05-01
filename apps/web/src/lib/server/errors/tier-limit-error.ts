export interface TierLimitErrorPayload {
  limit: string
  message: string
  current?: number
  max?: number
}

/**
 * Thrown when a write would breach a tier limit. Maps to HTTP 402
 * Payment Required. The structured payload (toResponseBody) is what
 * the upgrade-modal UX renders.
 *
 * Construction is cheap and pure — only thrown by enforcement seams,
 * never reached when EDITION!=cloud (because OSS_TIER_LIMITS leaves
 * every numeric limit null and every feature flag true, so the helpers
 * short-circuit before throwing).
 */
export class TierLimitError extends Error {
  readonly statusCode = 402
  readonly limit: string
  readonly current?: number
  readonly max?: number

  constructor(payload: TierLimitErrorPayload) {
    super(payload.message)
    this.name = 'TierLimitError'
    this.limit = payload.limit
    this.current = payload.current
    this.max = payload.max
  }

  toResponseBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      error: 'tier_limit_exceeded',
      limit: this.limit,
      message: this.message,
    }
    if (this.current !== undefined) body.current = this.current
    if (this.max !== undefined) body.max = this.max
    return body
  }
}
