import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetFeatureFlags = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getFeatureFlags: (...args: unknown[]) => mockGetFeatureFlags(...args),
}))

const mockRetrieve = vi.fn()
const mockSynthesize = vi.fn()
const mockIsConfigured = vi.fn()
const { MISS_FALLBACK } = vi.hoisted(() => ({ MISS_FALLBACK: 'No reliable answer found.' }))
vi.mock('@/lib/server/domains/assistant', () => ({
  retrieveKbArticles: (...args: unknown[]) => mockRetrieve(...args),
  synthesizeAnswer: (...args: unknown[]) => mockSynthesize(...args),
  isAskAiConfigured: (...args: unknown[]) => mockIsConfigured(...args),
  RELATED_SIMILARITY_FLOOR: 0.3,
  ASK_AI_MISS_FALLBACK: MISS_FALLBACK,
}))

const mockIncrementBucket = vi.fn()
const mockBucketRetryAfter = vi.fn()
vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => mockIncrementBucket(...args),
  bucketRetryAfter: (...args: unknown[]) => mockBucketRetryAfter(...args),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

const mockLogAiUsage = vi.fn()
vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  logAiUsage: (...args: unknown[]) => mockLogAiUsage(...args),
}))

const mockGetChatModel = vi.fn()
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (...args: unknown[]) => mockGetChatModel(...args),
}))

import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { handleKbAsk, KB_ASK_MAX_QUERY_CHARS, KB_ASK_RATE_LIMIT } from '../kb-ask'
import { parseAskAiSseBlock } from '@/components/help-center/ask-ai'
import { makeKbArticle } from '@/lib/server/domains/assistant/__tests__/kb-fixtures'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

function makeRequest(params: Record<string, string> = {}, ip = '203.0.113.9'): Request {
  const url = new URL('http://localhost/api/widget/kb-ask')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url, { headers: { 'x-forwarded-for': ip } })
}

/** Parse an SSE body into [{event, data}] frames, via the client's parser. */
function parseSse(body: string): Array<{ event: string; data: unknown }> {
  return body
    .split('\n\n')
    .map(parseAskAiSseBlock)
    .filter((frame): frame is { event: string; data: unknown } => frame !== null)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetFeatureFlags.mockResolvedValue({ helpCenter: true, helpCenterAiAnswers: true })
  mockIsConfigured.mockReturnValue(true)
  mockIncrementBucket.mockResolvedValue({ count: 1 })
  mockBucketRetryAfter.mockResolvedValue(42)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockLogAiUsage.mockResolvedValue(undefined)
  mockGetChatModel.mockReturnValue('gpt-test')
  mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
  mockSynthesize.mockResolvedValue({
    kind: 'grounded',
    answer: 'Do the thing.',
    sources: [{ articleId: 'kb_article_1' }],
  })
})

describe('GET /api/widget/kb-ask', () => {
  it('404s when the help center flag is off', async () => {
    mockGetFeatureFlags.mockResolvedValue({ helpCenter: false, helpCenterAiAnswers: true })
    const res = await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    expect(res.status).toBe(404)
  })

  it('404s when the AI answers flag is off', async () => {
    mockGetFeatureFlags.mockResolvedValue({ helpCenter: true, helpCenterAiAnswers: false })
    const res = await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    expect(res.status).toBe(404)
  })

  it('serves a capability probe when no query is given', async () => {
    const res = await handleKbAsk({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { enabled: true } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    // The probe must not consume rate-limit budget or hit retrieval.
    expect(mockIncrementBucket).not.toHaveBeenCalled()
    expect(mockRetrieve).not.toHaveBeenCalled()
  })

  it('reports enabled=false on the probe when AI is not configured', async () => {
    mockIsConfigured.mockReturnValue(false)
    const res = await handleKbAsk({ request: makeRequest() })
    expect(await res.json()).toEqual({ data: { enabled: false } })
  })

  it('400s on a blank query', async () => {
    const res = await handleKbAsk({ request: makeRequest({ q: '   ' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_QUERY')
  })

  it('413s when the query exceeds the length cap', async () => {
    const res = await handleKbAsk({
      request: makeRequest({ q: 'x'.repeat(KB_ASK_MAX_QUERY_CHARS + 1) }),
    })
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error.code).toBe('QUERY_TOO_LONG')
  })

  it('429s with Retry-After when over the per-IP limit', async () => {
    mockIncrementBucket.mockResolvedValue({ count: KB_ASK_RATE_LIMIT + 1 })
    const res = await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(mockRetrieve).not.toHaveBeenCalled()
  })

  it('fails open when Redis is down', async () => {
    mockIncrementBucket.mockResolvedValue({ count: null })
    const res = await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    expect(res.status).toBe(200)
  })

  it('503s when AI is not configured', async () => {
    mockIsConfigured.mockReturnValue(false)
    const res = await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error.code).toBe('AI_NOT_CONFIGURED')
  })

  it('responds with the tier-limit error when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: "You've used your AI budget" })
    )
    const res = await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error.code).toBe('TIER_LIMIT_EXCEEDED')
    expect(body.error.message).toBe("You've used your AI budget")
    // No streamed model answer: retrieval and synthesis never run.
    expect(mockRetrieve).not.toHaveBeenCalled()
    expect(mockSynthesize).not.toHaveBeenCalled()
  })

  it('checks the ai token budget after the rate limit but before retrieval', async () => {
    mockIncrementBucket.mockResolvedValue({ count: KB_ASK_RATE_LIMIT + 1 })
    await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('streams versioned sources, delta, and final events', async () => {
    mockSynthesize.mockImplementation(async (params: { onAnswerDelta?: (d: string) => void }) => {
      params.onAnswerDelta?.('Do the ')
      params.onAnswerDelta?.('thing.')
      return { kind: 'grounded', answer: 'Do the thing.', sources: [{ articleId: 'kb_article_1' }] }
    })

    const res = await handleKbAsk({ request: makeRequest({ q: 'how do I do the thing?' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')

    const frames = parseSse(await res.text())
    expect(frames.map((f) => f.event)).toEqual([
      'kb-ask.v1.sources',
      'kb-ask.v1.delta',
      'kb-ask.v1.delta',
      'kb-ask.v1.final',
    ])
    expect(frames[0].data).toEqual({
      sources: [
        {
          articleId: 'kb_article_1',
          title: 'Title kb_article_1',
          slug: 'slug-kb_article_1',
          categorySlug: 'general',
          categoryName: 'General',
        },
      ],
    })
    expect(frames[3].data).toEqual({
      kind: 'grounded',
      answer: 'Do the thing.',
      sources: [{ articleId: 'kb_article_1' }],
    })
  })

  it('short-circuits on empty retrieval: skips the model, returns a graceful miss with related', async () => {
    // Nothing cleared the answer floor. The model must NOT run on empty context:
    // with no articles it can only answer from training, and those ungrounded
    // deltas would stream to the client before the final no_answer lands. The
    // related lookup (softer floor, keyed by minScore) still surfaces a near-miss.
    mockRetrieve.mockImplementation(async (_q: string, opts?: { minScore?: number }) =>
      opts?.minScore !== undefined ? [makeKbArticle('kb_article_9')] : []
    )

    const res = await handleKbAsk({ request: makeRequest({ q: 'gibberish' }) })
    const frames = parseSse(await res.text())

    expect(mockSynthesize).not.toHaveBeenCalled()
    // No sources event (nothing retrieved) and no deltas: a single final miss.
    expect(frames.map((f) => f.event)).toEqual(['kb-ask.v1.final'])
    expect(frames.at(-1)).toEqual({
      event: 'kb-ask.v1.final',
      data: {
        kind: 'no_answer',
        answer: MISS_FALLBACK,
        sources: [],
        related: [
          {
            articleId: 'kb_article_9',
            title: 'Title kb_article_9',
            slug: 'slug-kb_article_9',
            categorySlug: 'general',
            categoryName: 'General',
          },
        ],
      },
    })
  })

  it('logs a no_sources ai usage entry on the empty-retrieval short-circuit', async () => {
    mockRetrieve.mockImplementation(async (_q: string, opts?: { minScore?: number }) =>
      opts?.minScore !== undefined ? [makeKbArticle('kb_article_9')] : []
    )
    const res = await handleKbAsk({ request: makeRequest({ q: 'gibberish' }) })
    await res.text()

    expect(mockSynthesize).not.toHaveBeenCalled()
    expect(mockLogAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineStep: 'help_center_answers',
        callType: 'chat_completion',
        model: 'gpt-test',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        status: 'success',
        metadata: { answerKind: 'no_sources', query: 'gibberish' },
      })
    )
  })

  it('reuses the retrieved articles as related suggestions on a no-answer', async () => {
    // Articles were retrieved but did not answer: they become the suggestions,
    // with no extra retrieval round-trip.
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    mockSynthesize.mockResolvedValue({
      kind: 'no_answer',
      answer: 'I could not find a specific answer to that.',
      sources: [],
    })

    const res = await handleKbAsk({ request: makeRequest({ q: 'nearby topic' }) })
    const frames = parseSse(await res.text())
    const final = frames.at(-1)?.data as { kind: string; related: Array<{ articleId: string }> }

    expect(final.kind).toBe('no_answer')
    expect(final.related.map((r) => r.articleId)).toEqual(['kb_article_1'])
    // The retrieved set was reused; no second retrieval call.
    expect(mockRetrieve).toHaveBeenCalledTimes(1)
  })

  it('emits a versioned error event when synthesis fails', async () => {
    mockSynthesize.mockRejectedValue(new Error('provider down'))
    const res = await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    const frames = parseSse(await res.text())
    expect(frames.at(-1)?.event).toBe('kb-ask.v1.error')
    expect((frames.at(-1)?.data as { code: string }).code).toBe('SYNTHESIS_FAILED')
  })

  it('retrieves with the public audience and an anonymous viewer for unidentified callers', async () => {
    await handleKbAsk({ request: makeRequest({ q: 'hello' }) })
    expect(mockRetrieve).toHaveBeenCalledWith('hello', {
      audience: 'public',
      viewer: ANONYMOUS_ACTOR,
    })
  })
})
