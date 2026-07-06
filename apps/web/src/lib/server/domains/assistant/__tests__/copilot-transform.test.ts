/**
 * Unit tests for the Copilot transform module (P2-C.1): the prompt shape
 * (injection guard, grounding rules, one-transform-at-a-time isolation), the
 * `my_tone` style-excerpt mining query and its graceful no-history fallback,
 * and `runCopilotTransform`'s streaming + salvage behavior via the shared
 * synthesis core (mirrors `synthesis.test.ts`'s mocking of `chat()`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const styleRows = vi.hoisted(() => ({ current: [] as Array<{ content: string | null }> }))

vi.mock('@/lib/server/db', () => {
  const builder = {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => Promise.resolve(styleRows.current),
  }
  return {
    db: builder,
    conversationMessages: {
      content: 'content',
      principalId: 'principal_id',
      senderType: 'sender_type',
      isInternal: 'is_internal',
      deletedAt: 'deleted_at',
      createdAt: 'created_at',
    },
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    isNull: vi.fn(() => ({})),
  }
})

const mockChat = vi.fn()
const mockAdapterFactory = vi.fn((..._args: unknown[]) => ({ kind: 'text' }))

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
  aiChatModel: 'test-model' as string | undefined,
  aiAssistantModel: undefined as string | undefined,
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  parsePartialJSON: (s: string) => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  },
}))

vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (...args: unknown[]) => mockAdapterFactory(...args),
}))

const mockWithUsageLogging = vi.fn()
vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  withUsageLogging: (...args: unknown[]) => mockWithUsageLogging(...args),
}))

import {
  buildTransformSystemPrompts,
  fetchTeammateStyleExcerpts,
  runCopilotTransform,
} from '../copilot-transform'
import type { PrincipalId } from '@quackback/ids'

const PRINCIPAL_ID = 'principal_1' as PrincipalId

function chunkStream(chunks: unknown[]) {
  return (async function* () {
    for (const c of chunks) yield c
  })()
}

function completeRun(object: unknown, raw: string) {
  return [
    { type: 'TEXT_MESSAGE_CONTENT', delta: raw },
    { type: 'CUSTOM', name: 'structured-output.complete', value: { object, raw } },
    { type: 'RUN_FINISHED', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  styleRows.current = []
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockConfig.aiChatModel = 'test-model'
  mockConfig.aiAssistantModel = undefined
  mockWithUsageLogging.mockImplementation(
    async (
      _params: unknown,
      fn: () => Promise<{ result: unknown; retryCount: number }>,
      extract: (result: unknown) => unknown
    ) => {
      const { result } = await fn()
      extract(result)
      return result
    }
  )
})

describe('buildTransformSystemPrompts', () => {
  it('carries the injection guard around the quoted input text', () => {
    const joined = buildTransformSystemPrompts('more_friendly', 'Please refund me').join('\n')
    expect(joined.toLowerCase()).toContain('not instructions')
    expect(joined).toContain('"""\nPlease refund me\n"""')
  })

  it('never adds facts and preserves inline formatting per the grounding rules', () => {
    const joined = buildTransformSystemPrompts('more_concise', 'Some text').join('\n')
    expect(joined.toLowerCase()).toContain('never add facts')
    expect(joined.toLowerCase()).toContain('inline formatting')
  })

  it('requires a strict JSON {"text": ...} reply', () => {
    const joined = buildTransformSystemPrompts('rephrase', 'Some text').join('\n')
    expect(joined).toContain('{"text": string}')
  })

  it("carries only the selected transform's task, not another transform's instructions", () => {
    const friendly = buildTransformSystemPrompts('more_friendly', 'x').join('\n')
    expect(friendly.toLowerCase()).toContain('friendly')
    expect(friendly.toLowerCase()).not.toContain('formal')
    expect(friendly.toLowerCase()).not.toContain('grammar')

    const grammar = buildTransformSystemPrompts('fix_grammar', 'x').join('\n')
    expect(grammar.toLowerCase()).toContain('grammar')
    expect(grammar.toLowerCase()).not.toContain('friendly')
  })

  it('includes a style-reference block only for my_tone, framed as reference only', () => {
    const myTone = buildTransformSystemPrompts('my_tone', 'x', [
      'Thanks so much for writing in!',
    ]).join('\n')
    expect(myTone).toContain('Thanks so much for writing in!')
    expect(myTone.toLowerCase()).toContain('not content to copy')

    const other = buildTransformSystemPrompts('more_formal', 'x', [
      'Thanks so much for writing in!',
    ])
    expect(other.join('\n')).not.toContain('Thanks so much for writing in!')
  })

  it('degrades my_tone to a neutral professional-voice instruction with no prior replies', () => {
    const joined = buildTransformSystemPrompts('my_tone', 'x', []).join('\n')
    expect(joined.toLowerCase()).toContain('professional, warm support voice')
  })
})

describe('fetchTeammateStyleExcerpts', () => {
  it('returns truncated excerpts from the mined rows, newest first, capped at 3', async () => {
    styleRows.current = [
      { content: 'a'.repeat(500) },
      { content: 'Second reply.' },
      { content: 'Third reply.' },
      { content: 'Fourth reply (should be dropped by the cap).' },
    ]
    const excerpts = await fetchTeammateStyleExcerpts(PRINCIPAL_ID)
    expect(excerpts).toHaveLength(3)
    expect(excerpts[0]).toHaveLength(400) // truncated to the excerpt char budget
    expect(excerpts[1]).toBe('Second reply.')
    expect(excerpts[2]).toBe('Third reply.')
  })

  it('skips empty/whitespace-only rows', async () => {
    styleRows.current = [{ content: '   ' }, { content: null }, { content: 'Real reply.' }]
    const excerpts = await fetchTeammateStyleExcerpts(PRINCIPAL_ID)
    expect(excerpts).toEqual(['Real reply.'])
  })

  it('returns an empty array when the teammate has no prior replies', async () => {
    styleRows.current = []
    const excerpts = await fetchTeammateStyleExcerpts(PRINCIPAL_ID)
    expect(excerpts).toEqual([])
  })
})

describe('runCopilotTransform', () => {
  it('returns the rewritten text and streams deltas', async () => {
    const object = { text: 'Warmed-up reply.' }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    const deltas: string[] = []
    const result = await runCopilotTransform({
      transform: 'more_friendly',
      text: 'Reply text.',
      principalId: PRINCIPAL_ID,
      onTextDelta: (d) => deltas.push(d),
    })

    expect(result).toEqual(object)
    expect(deltas.join('')).toBe('Warmed-up reply.')
  })

  it('mines style excerpts only for my_tone', async () => {
    styleRows.current = [{ content: 'My usual sign-off.' }]
    const object = { text: 'Rewritten in my voice.' }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    await runCopilotTransform({
      transform: 'my_tone',
      text: 'Reply text.',
      principalId: PRINCIPAL_ID,
    })

    const call = mockChat.mock.calls[0][0] as { systemPrompts: string[] }
    expect(call.systemPrompts.join('\n')).toContain('My usual sign-off.')
  })

  it('does not query style excerpts for a non-my_tone transform', async () => {
    const object = { text: 'Rewritten.' }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    await runCopilotTransform({
      transform: 'more_concise',
      text: 'Reply text.',
      principalId: PRINCIPAL_ID,
    })

    const call = mockChat.mock.calls[0][0] as { systemPrompts: string[] }
    expect(call.systemPrompts.join('\n').toLowerCase()).not.toContain('style reference')
  })

  it('salvages a fenced-JSON reply when no structured object arrives', async () => {
    const raw = '```json\n{"text":"Salvaged text."}\n```'
    mockChat.mockReturnValueOnce(
      chunkStream([
        { type: 'TEXT_MESSAGE_CONTENT', delta: raw },
        { type: 'RUN_FINISHED', usage: undefined },
      ])
    )

    const result = await runCopilotTransform({
      transform: 'rephrase',
      text: 'Reply text.',
      principalId: PRINCIPAL_ID,
    })
    expect(result).toEqual({ text: 'Salvaged text.' })
  })

  it('throws on a total failure (no fallback value, unlike the customer-facing turn)', async () => {
    mockChat.mockImplementation(() =>
      chunkStream([{ type: 'RUN_ERROR', message: 'provider exploded' }])
    )

    await expect(
      runCopilotTransform({ transform: 'expand', text: 'Reply text.', principalId: PRINCIPAL_ID })
    ).rejects.toThrow(/provider exploded/)
  })

  it('logs usage with the transform kind in metadata', async () => {
    const object = { text: 'Rewritten.' }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    await runCopilotTransform({
      transform: 'fix_grammar',
      text: 'Reply text.',
      principalId: PRINCIPAL_ID,
    })

    const [params] = mockWithUsageLogging.mock.calls[0]
    expect(params).toMatchObject({
      pipelineStep: 'copilot_transform',
      callType: 'chat_completion',
      model: 'test-model',
      metadata: { transform: 'fix_grammar' },
    })
  })
})
