import { describe, it, expect } from 'vitest'
import { safeAIError } from '../safe-error'

const PII_CANARY = 'secret-bearer-sk-test-123456-user@example.com-prompt-leak'

describe('safeAIError enumerated taxonomy', () => {
  it('classifies daily/burst quota 429 as quota_refused without leaking text', () => {
    const wrapped = new Error(`Chat failed: ${PII_CANARY}`, {
      cause: {
        status: 429,
        headers: new Headers({ 'x-should-retry': 'false' }),
        error: {
          code: 'rate_limit_exceeded',
          message: `AI burst rate limit exceeded ${PII_CANARY}`,
        },
      },
    })
    const out = safeAIError(wrapped, { stage: 'inbox_translation', attempt: 1 })
    expect(out).toEqual({
      httpStatus: 429,
      errorClass: 'quota_refused',
      finishReason: null,
      attempt: 1,
      stage: 'inbox_translation',
    })
    expect(JSON.stringify(out)).not.toContain(PII_CANARY)
  })

  it('classifies upstream 429 without quota markers as rate_limited', () => {
    const out = safeAIError(
      { status: 429, message: `Too many requests ${PII_CANARY}` },
      { stage: 'classification' }
    )
    expect(out).toEqual({
      httpStatus: 429,
      errorClass: 'rate_limited',
      finishReason: null,
      attempt: null,
      stage: 'classification',
    })
  })

  it('covers all enumerated errorClass variants and sanitizes stage/finishReason/attempt', () => {
    expect(safeAIError({ status: 403, message: PII_CANARY }).errorClass).toBe('auth_error')
    expect(safeAIError({ status: 400, message: PII_CANARY }).errorClass).toBe('upstream_4xx')
    expect(safeAIError({ status: 502, message: PII_CANARY }).errorClass).toBe('upstream_5xx')
    expect(safeAIError({ status: 504, message: PII_CANARY }).errorClass).toBe('timeout')
    expect(safeAIError(new DOMException(PII_CANARY, 'AbortError')).errorClass).toBe('timeout')
    expect(safeAIError({ code: 'ECONNRESET', message: PII_CANARY }).errorClass).toBe(
      'network_error'
    )
    expect(safeAIError({ name: 'ZodError', message: PII_CANARY }).errorClass).toBe('schema_invalid')
    expect(
      safeAIError({ message: PII_CANARY }, { finishReason: 'content_filter' }).errorClass
    ).toBe('content_filtered')

    const sanitized = safeAIError(new Error(PII_CANARY), {
      stage: PII_CANARY,
      finishReason: PII_CANARY,
      attempt: -5,
    })
    expect(sanitized).toEqual({
      httpStatus: null,
      errorClass: 'unknown',
      finishReason: null,
      attempt: null,
      stage: 'other',
    })
    expect(JSON.stringify(sanitized)).not.toContain(PII_CANARY)
  })

  it('survives circular cause chains and throwing getters safely', () => {
    const cycle: Record<string, unknown> = { message: PII_CANARY }
    cycle.cause = cycle
    expect(safeAIError(cycle)).toEqual({
      httpStatus: null,
      errorClass: 'unknown',
      finishReason: null,
      attempt: null,
      stage: null,
    })

    const poisoned = Object.defineProperty({}, 'status', {
      get() {
        throw new Error(PII_CANARY)
      },
    })
    expect(safeAIError(poisoned).httpStatus).toBeNull()
  })
})
