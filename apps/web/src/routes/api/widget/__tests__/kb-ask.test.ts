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

const mockGetSettings = vi.fn()
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}))

import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { handleKbAsk, handleKbAskProbe, KB_ASK_MAX_QUERY_CHARS, KB_ASK_RATE_LIMIT } from '../kb-ask'
import { makeKbArticle } from '@/lib/server/domains/assistant/__tests__/kb-fixtures'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

/** Build an AG-UI RunAgentInput POST request. `question` rides the trailing
 *  user message; omit it (or pass null) to send a question-less body. */
function makePost(
  question: string | null,
  ip = '203.0.113.9',
  extraHeaders: Record<string, string> = {}
): Request {
  const messages = question === null ? [] : [{ id: 'q', role: 'user', content: question }]
  return new Request('http://localhost/api/widget/kb-ask', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, ...extraHeaders },
    body: JSON.stringify({
      threadId: 'thread-test',
      runId: 'run-test',
      messages,
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    }),
  })
}

/** A bare GET (the capability probe). */
function makeProbe(): Request {
  return new Request('http://localhost/api/widget/kb-ask', {
    headers: { 'x-forwarded-for': '203.0.113.9' },
  })
}

/** Parse toServerSentEventsResponse output: `data: <json>` blocks. */
function parseAguiSse(text: string): Array<Record<string, unknown> & { type: string }> {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)))
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
  mockGetSettings.mockResolvedValue({ id: 'settings_1' })
  mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
  mockSynthesize.mockResolvedValue({
    kind: 'grounded',
    answer: 'Do the thing.',
    sources: [{ articleId: 'kb_article_1' }],
  })
})

const SOURCE_META = {
  articleId: 'kb_article_1',
  title: 'Title kb_article_1',
  slug: 'slug-kb_article_1',
  categorySlug: 'general',
  categoryName: 'General',
}

describe('GET /api/widget/kb-ask (capability probe)', () => {
  it('404s when the help center flag is off', async () => {
    mockGetFeatureFlags.mockResolvedValue({ helpCenter: false, helpCenterAiAnswers: true })
    const res = await handleKbAskProbe({ request: makeProbe() })
    expect(res.status).toBe(404)
  })

  it('404s when the AI answers flag is off', async () => {
    mockGetFeatureFlags.mockResolvedValue({ helpCenter: true, helpCenterAiAnswers: false })
    const res = await handleKbAskProbe({ request: makeProbe() })
    expect(res.status).toBe(404)
  })

  it('serves a capability probe with the widget CORS header', async () => {
    const res = await handleKbAskProbe({ request: makeProbe() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { enabled: true } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    // The probe must not consume rate-limit budget or hit retrieval.
    expect(mockIncrementBucket).not.toHaveBeenCalled()
    expect(mockRetrieve).not.toHaveBeenCalled()
  })

  it('reports enabled=false on the probe when AI is not configured', async () => {
    mockIsConfigured.mockReturnValue(false)
    const res = await handleKbAskProbe({ request: makeProbe() })
    expect(await res.json()).toEqual({ data: { enabled: false } })
  })
})

describe('POST /api/widget/kb-ask', () => {
  it('404s when the AI answers flag is off', async () => {
    mockGetFeatureFlags.mockResolvedValue({ helpCenter: true, helpCenterAiAnswers: false })
    const res = await handleKbAsk({ request: makePost('hello') })
    expect(res.status).toBe(404)
  })

  it('400s on a non-AG-UI body', async () => {
    const res = await handleKbAsk({
      request: new Request('http://localhost/api/widget/kb-ask', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify({ q: 'hello' }),
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_REQUEST')
  })

  it('400s when the AG-UI messages carry no trailing user question', async () => {
    const res = await handleKbAsk({ request: makePost(null) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_QUERY')
  })

  it('400s on a blank query', async () => {
    const res = await handleKbAsk({ request: makePost('   ') })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_QUERY')
  })

  it('413s when the query exceeds the length cap', async () => {
    const res = await handleKbAsk({ request: makePost('x'.repeat(KB_ASK_MAX_QUERY_CHARS + 1)) })
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error.code).toBe('QUERY_TOO_LONG')
  })

  it('429s with Retry-After when over the per-IP limit', async () => {
    mockIncrementBucket.mockResolvedValue({ count: KB_ASK_RATE_LIMIT + 1 })
    const res = await handleKbAsk({ request: makePost('hello') })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(mockRetrieve).not.toHaveBeenCalled()
  })

  it('429s when a single anonymous session exceeds its own budget, even under the IP limit', async () => {
    mockIncrementBucket.mockImplementation(async (spec: { key: string }) =>
      spec.key.includes(':session:') ? { count: KB_ASK_RATE_LIMIT + 1 } : { count: 1 }
    )
    const res = await handleKbAsk({
      request: makePost('hello', '203.0.113.9', { Authorization: 'Bearer session-a' }),
    })
    expect(res.status).toBe(429)
    expect(mockRetrieve).not.toHaveBeenCalled()
  })

  it('keys the session bucket off the bearer token, independent of other sessions on the same IP', async () => {
    mockIncrementBucket.mockImplementation(async (spec: { key: string }) => ({
      count: spec.key.includes('session-a') ? KB_ASK_RATE_LIMIT + 1 : 1,
    }))
    const res = await handleKbAsk({
      request: makePost('hello', '203.0.113.9', { Authorization: 'Bearer session-b' }),
    })
    expect(res.status).toBe(200)
  })

  it('503s when the workspace is unavailable', async () => {
    mockGetSettings.mockResolvedValue(null)
    const res = await handleKbAsk({ request: makePost('hello') })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error.code).toBe('WORKSPACE_UNAVAILABLE')
    expect(mockRetrieve).not.toHaveBeenCalled()
  })

  it('keys the tenant bucket off the resolved workspace id, not a caller-supplied header', async () => {
    mockGetSettings.mockResolvedValue({ id: 'settings_evade_test' })
    await handleKbAsk({ request: makePost('hello') })
    const keys = mockIncrementBucket.mock.calls.map(([spec]) => spec.key)
    expect(keys).toContain('kbask:tenant:settings_evade_test')
  })

  it('fails open when Redis is down', async () => {
    mockIncrementBucket.mockResolvedValue({ count: null })
    const res = await handleKbAsk({ request: makePost('hello') })
    expect(res.status).toBe(200)
  })

  it('503s when AI is not configured', async () => {
    mockIsConfigured.mockReturnValue(false)
    const res = await handleKbAsk({ request: makePost('hello') })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error.code).toBe('AI_NOT_CONFIGURED')
  })

  it('responds with the tier-limit error when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: "You've used your AI budget" })
    )
    const res = await handleKbAsk({ request: makePost('hello') })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error.code).toBe('TIER_LIMIT_EXCEEDED')
    expect(body.error.message).toBe("You've used your AI budget")
    expect(mockRetrieve).not.toHaveBeenCalled()
    expect(mockSynthesize).not.toHaveBeenCalled()
  })

  it('checks the ai token budget after the rate limit but before retrieval', async () => {
    mockIncrementBucket.mockResolvedValue({ count: KB_ASK_RATE_LIMIT + 1 })
    await handleKbAsk({ request: makePost('hello') })
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('streams RUN_STARTED, STATE_SNAPSHOT, forwarded model chunks, then RUN_FINISHED.result', async () => {
    mockSynthesize.mockImplementation(
      async (params: { wireSink?: (chunk: Record<string, unknown>) => void }) => {
        params.wireSink?.({ type: 'TEXT_MESSAGE_START', messageId: 'm1' })
        params.wireSink?.({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'm1',
          delta: '{"answer":"Do the',
        })
        params.wireSink?.({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' thing."}' })
        params.wireSink?.({ type: 'TEXT_MESSAGE_END', messageId: 'm1' })
        return {
          kind: 'grounded',
          answer: 'Do the thing.',
          sources: [{ articleId: 'kb_article_1' }],
        }
      }
    )

    const res = await handleKbAsk({ request: makePost('how do I do the thing?') })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')

    const chunks = parseAguiSse(await res.text())
    expect(chunks[0]).toMatchObject({
      type: 'RUN_STARTED',
      threadId: 'thread-test',
      runId: 'run-test',
    })
    // STATE_SNAPSHOT carries the pre-synthesis source metadata join, first.
    expect(chunks[1]).toMatchObject({
      type: 'STATE_SNAPSHOT',
      snapshot: { sources: [SOURCE_META] },
    })
    // The forwarded model chunks land between the snapshot and the terminal frame.
    expect(chunks.map((c) => c.type)).toEqual([
      'RUN_STARTED',
      'STATE_SNAPSHOT',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ])
    const finished = chunks.at(-1) as { type: string; result?: unknown }
    expect(finished.result).toEqual({
      kind: 'grounded',
      answer: 'Do the thing.',
      sources: [{ articleId: 'kb_article_1' }],
    })
  })

  it('short-circuits on empty retrieval: no snapshot, no model call, RUN_FINISHED miss with related', async () => {
    mockRetrieve.mockImplementation(async (_q: string, opts?: { minScore?: number }) =>
      opts?.minScore !== undefined ? [makeKbArticle('kb_article_9')] : []
    )

    const res = await handleKbAsk({ request: makePost('gibberish') })
    const chunks = parseAguiSse(await res.text())

    expect(mockSynthesize).not.toHaveBeenCalled()
    // No STATE_SNAPSHOT (nothing retrieved): just the lifecycle pair.
    expect(chunks.map((c) => c.type)).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
    expect((chunks.at(-1) as { result?: unknown }).result).toEqual({
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
    })
  })

  it('logs a no_sources ai usage entry on the empty-retrieval short-circuit', async () => {
    mockRetrieve.mockImplementation(async (_q: string, opts?: { minScore?: number }) =>
      opts?.minScore !== undefined ? [makeKbArticle('kb_article_9')] : []
    )
    const res = await handleKbAsk({ request: makePost('gibberish') })
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
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    mockSynthesize.mockResolvedValue({
      kind: 'no_answer',
      answer: 'I could not find a specific answer to that.',
      sources: [],
    })

    const res = await handleKbAsk({ request: makePost('nearby topic') })
    const chunks = parseAguiSse(await res.text())
    const result = (
      chunks.at(-1) as { result?: { kind: string; related: Array<{ articleId: string }> } }
    ).result!

    expect(result.kind).toBe('no_answer')
    expect(result.related.map((r) => r.articleId)).toEqual(['kb_article_1'])
    // The retrieved set was reused; no second retrieval call.
    expect(mockRetrieve).toHaveBeenCalledTimes(1)
  })

  it('emits a RUN_ERROR frame when synthesis fails', async () => {
    mockSynthesize.mockRejectedValue(new Error('provider down'))
    const res = await handleKbAsk({ request: makePost('hello') })
    const chunks = parseAguiSse(await res.text())
    const last = chunks.at(-1) as { type: string; code?: string }
    expect(last.type).toBe('RUN_ERROR')
    expect(last.code).toBe('SYNTHESIS_FAILED')
  })

  it('retrieves with the public audience and an anonymous viewer for unidentified callers', async () => {
    const res = await handleKbAsk({ request: makePost('hello') })
    await res.text()
    expect(mockRetrieve).toHaveBeenCalledWith('hello', {
      audience: 'public',
      viewer: ANONYMOUS_ACTOR,
    })
  })
})
