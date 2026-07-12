import { describe, it, expect } from 'vitest'
import { actionSchema } from '../workflow.schemas'

/**
 * WO-10 — the send_webhook workflow action. Schema-level validation; the
 * executor case delivers through safeFetch (the SSRF chokepoint) and is covered
 * by the workflow action suite's typecheck + regression run. (The other half of
 * WO-10, widening triggers to post/comment/changelog, is a larger
 * conversation-dispatcher change left for a focused effort.)
 */
describe('send_webhook action (WO-10)', () => {
  it('accepts a valid https url', () => {
    const parsed = actionSchema.parse({ type: 'send_webhook', url: 'https://example.test/hook' })
    expect(parsed).toEqual({ type: 'send_webhook', url: 'https://example.test/hook' })
  })

  it('rejects a non-url', () => {
    expect(() => actionSchema.parse({ type: 'send_webhook', url: 'not-a-url' })).toThrow()
  })

  it('rejects unknown extra fields (strict)', () => {
    expect(() =>
      actionSchema.parse({ type: 'send_webhook', url: 'https://x.test', evil: 1 })
    ).toThrow()
  })
})
