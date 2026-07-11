/**
 * CSAT-over-email token mint/verify round trip + the token-authorized record
 * fn (support platform's CSAT-over-email extension). The public `/csat`
 * route has no session — the signed token is the sole credential — so this
 * pins the HMAC scheme's correctness (valid/tampered/expired) and the
 * record-via-token wiring (rating, latest-wins comment, failure handling).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

let secretKey = 'test-secret-key-csat-email-0123456789'
vi.mock('@/lib/server/config', () => ({
  config: {
    get secretKey() {
      return secretKey
    },
  },
}))

// createServerFn → directly-callable fn, with the real zod validator applied
// (mirrors assistant-tools-analytics.test.ts).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const recordCsat = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({ recordCsat }))

import { mintCsatEmailToken, recordCsatViaTokenFn } from '../csat-email'

const conversationId = 'conversation_1' as ConversationId
const principalId = 'principal_visitor' as PrincipalId

beforeEach(() => {
  vi.clearAllMocks()
  secretKey = 'test-secret-key-csat-email-0123456789'
})

describe('mintCsatEmailToken / recordCsatViaTokenFn round trip', () => {
  it('records the rating via a freshly minted token', async () => {
    const token = mintCsatEmailToken(conversationId, principalId)
    recordCsat.mockResolvedValue(undefined)

    const result = await recordCsatViaTokenFn({ data: { token, rating: 4 } })

    expect(result).toEqual({ success: true })
    expect(recordCsat).toHaveBeenCalledTimes(1)
    const [convArg, ratingArg, commentArg, actorArg] = recordCsat.mock.calls[0]!
    expect(convArg).toBe(conversationId)
    expect(ratingArg).toBe(4)
    expect(commentArg).toBeUndefined()
    // The token's own principal, visitor-scoped — the same construction the
    // workflow engine's record_csat action uses (see workflow.engine.ts's
    // visitorActor).
    expect(actorArg).toMatchObject({ principalId, principalType: 'anonymous', role: null })
  })

  it("records a follow-up comment through the same fn (latest-wins, recordCsat's own contract)", async () => {
    const token = mintCsatEmailToken(conversationId, principalId)
    recordCsat.mockResolvedValue(undefined)

    const result = await recordCsatViaTokenFn({
      data: { token, rating: 4, comment: 'Great support!' },
    })

    expect(result).toEqual({ success: true })
    expect(recordCsat).toHaveBeenCalledWith(conversationId, 4, 'Great support!', expect.anything())
  })

  it('is idempotent: re-clicking the same rating link re-records without erroring', async () => {
    const token = mintCsatEmailToken(conversationId, principalId)
    recordCsat.mockResolvedValue(undefined)

    await recordCsatViaTokenFn({ data: { token, rating: 5 } })
    const result = await recordCsatViaTokenFn({ data: { token, rating: 5 } })

    expect(result).toEqual({ success: true })
    expect(recordCsat).toHaveBeenCalledTimes(2)
  })

  it('rejects a tampered token (flipped signature byte)', async () => {
    const token = mintCsatEmailToken(conversationId, principalId)
    const lastChar = token.at(-1)!
    const flipped = lastChar === 'A' ? 'B' : 'A'
    const tampered = token.slice(0, -1) + flipped

    const result = await recordCsatViaTokenFn({ data: { token: tampered, rating: 4 } })
    expect(result).toEqual({ success: false, error: 'invalid' })
    expect(recordCsat).not.toHaveBeenCalled()
  })

  it('rejects an expired token', async () => {
    const token = mintCsatEmailToken(conversationId, principalId, -1000)
    const result = await recordCsatViaTokenFn({ data: { token, rating: 4 } })
    expect(result).toEqual({ success: false, error: 'invalid' })
    expect(recordCsat).not.toHaveBeenCalled()
  })

  it('rejects a token signed under a different secret', async () => {
    const token = mintCsatEmailToken(conversationId, principalId)
    secretKey = 'a-completely-different-secret-key-value'
    const result = await recordCsatViaTokenFn({ data: { token, rating: 4 } })
    expect(result).toEqual({ success: false, error: 'invalid' })
  })

  it('rejects a malformed token string without crashing', async () => {
    const result = await recordCsatViaTokenFn({ data: { token: 'not-a-real-token', rating: 4 } })
    expect(result).toEqual({ success: false, error: 'invalid' })
  })

  it('reports a failure (rather than throwing) when recordCsat itself rejects', async () => {
    const token = mintCsatEmailToken(conversationId, principalId)
    recordCsat.mockRejectedValue(new Error('conversation not found'))

    const result = await recordCsatViaTokenFn({ data: { token, rating: 4 } })
    expect(result).toEqual({ success: false, error: 'failed' })
  })
})
