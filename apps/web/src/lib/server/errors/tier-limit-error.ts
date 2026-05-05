import { DomainException } from '@/lib/shared/errors'

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
 * Never reached when no tier limits are set (the OSS default) because
 * the enforce* helpers short-circuit on null limits / true feature flags.
 */
export class TierLimitError extends DomainException {
  readonly statusCode = 402
  readonly limit: string
  readonly current?: number
  readonly max?: number

  constructor(payload: TierLimitErrorPayload) {
    super('TIER_LIMIT_EXCEEDED', payload.message)
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
