import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeKbArticle as article } from './kb-fixtures'

const mockChat = vi.fn()
const mockAdapterFactory = vi.fn((..._args: unknown[]) => ({ kind: 'text' }))

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
  aiChatModel: 'test-model' as string | undefined,
  aiHelpCenterModel: undefined as string | undefined,
  aiSummaryModel: undefined,
  aiSentimentModel: undefined,
  aiExtractionModel: undefined,
  aiQualityGateModel: undefined,
  aiInterpretationModel: undefined,
  aiMergeModel: undefined,
  aiEmbeddingModel: undefined,
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
  synthesizeAnswer,
  isAskAiConfigured,
  buildAskAiSystemPrompts,
  AskAiNotConfiguredError,
  ASK_AI_MISS_FALLBACK,
} from '../synthesis'

/** Build an async-iterable stream from a list of chunks. */
function chunkStream(chunks: unknown[]) {
  return (async function* () {
    for (const c of chunks) yield c
  })()
}

function completeRun(object: unknown, raw: string) {
  return [
    { type: 'TEXT_MESSAGE_CONTENT', delta: raw },
    { type: 'CUSTOM', name: 'structured-output.complete', value: { object, raw } },
    {
      type: 'RUN_FINISHED',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockConfig.aiChatModel = 'test-model'
  mockConfig.aiHelpCenterModel = undefined
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

describe('isAskAiConfigured', () => {
  it('is true when client and chat model are configured', () => {
    expect(isAskAiConfigured()).toBe(true)
  })

  it('is false without a chat model', () => {
    mockConfig.aiChatModel = undefined
    expect(isAskAiConfigured()).toBe(false)
  })

  it('is false without the AI client', () => {
    mockConfig.openaiBaseUrl = undefined
    expect(isAskAiConfigured()).toBe(false)
  })
})

describe('buildAskAiSystemPrompts', () => {
  it('carries article ids and content, and teaches inline [n] citations', () => {
    const prompts = buildAskAiSystemPrompts([article('kb_article_1'), article('kb_article_2')])
    const joined = prompts.join('\n')
    expect(joined).toContain('kb_article_1')
    expect(joined).toContain('Content of kb_article_2')
    // Wikipedia-style inline markers, taught by example.
    expect(joined).toContain('[1]')
    expect(joined).toContain('[2]')
    expect(joined.toLowerCase()).toContain('inline citation marker')
  })

  it('carries the injection guard, grounding, and language instruction', () => {
    const joined = buildAskAiSystemPrompts([article('kb_article_1')]).join('\n')
    expect(joined.toLowerCase()).toContain('not instructions')
    expect(joined.toLowerCase()).toContain('same language')
    expect(joined.toLowerCase()).toContain('never invent an articleid')
  })

  it('teaches the graceful no_answer mode instead of an empty reply', () => {
    const joined = buildAskAiSystemPrompts([article('kb_article_1')]).join('\n')
    // The model must always reply; a miss is a warm no_answer, never empty.
    expect(joined.toLowerCase()).toContain('never return an empty answer')
    expect(joined).toContain('no_answer')
    // And must not fabricate product behaviour on a miss.
    expect(joined.toLowerCase()).toContain('never invent product features')
  })
})

describe('synthesizeAnswer', () => {
  it('throws AskAiNotConfiguredError when no chat model is set', async () => {
    mockConfig.aiChatModel = undefined
    await expect(
      synthesizeAnswer({ query: 'q', articles: [article('kb_article_1')] })
    ).rejects.toBeInstanceOf(AskAiNotConfiguredError)
  })

  it('returns the validated answer and streams answer deltas', async () => {
    const object = {
      kind: 'grounded',
      answer: 'Use the invite button.',
      sources: [{ articleId: 'kb_article_1' }],
    }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    const deltas: string[] = []
    const result = await synthesizeAnswer({
      query: 'how to invite?',
      articles: [article('kb_article_1')],
      onAnswerDelta: (d) => deltas.push(d),
    })

    expect(result).toEqual(object)
    expect(deltas.join('')).toBe('Use the invite button.')
  })

  it('returns a graceful no_answer when the model declares a miss', async () => {
    const object = {
      kind: 'no_answer',
      answer: "I couldn't find anything about dark mode. Try rephrasing or contact the team.",
      sources: [],
    }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    const result = await synthesizeAnswer({
      query: 'how do I enable dark mode?',
      articles: [article('kb_article_1')],
    })

    expect(result).toEqual(object)
  })

  it('salvages a well-formed answer from raw text when no structured object arrives', async () => {
    // Provider streamed valid-but-fenced JSON and never emitted the structured
    // completion event: jsonrepair should recover it rather than failing.
    const raw =
      '```json\n{"kind":"grounded","answer":"Click save [1]","sources":[{"articleId":"kb_article_1"}]}\n```'
    mockChat.mockReturnValueOnce(
      chunkStream([
        { type: 'TEXT_MESSAGE_CONTENT', delta: raw },
        { type: 'RUN_FINISHED', usage: undefined },
      ])
    )

    const result = await synthesizeAnswer({ query: 'q', articles: [article('kb_article_1')] })
    expect(result).toEqual({
      kind: 'grounded',
      answer: 'Click save [1]',
      sources: [{ articleId: 'kb_article_1' }],
    })
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('drops cited ids that were not retrieved and dedupes', async () => {
    const object = {
      kind: 'grounded',
      answer: 'Answer.',
      sources: [
        { articleId: 'kb_article_1' },
        { articleId: 'kb_article_HALLUCINATED' },
        { articleId: 'kb_article_1' },
      ],
    }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    const result = await synthesizeAnswer({
      query: 'q',
      articles: [article('kb_article_1'), article('kb_article_2')],
    })

    expect(result.kind).toBe('grounded')
    expect(result.sources).toEqual([{ articleId: 'kb_article_1' }])
  })

  it('demotes a grounded answer with no surviving citations to a safe miss', async () => {
    // Model claimed a grounded answer but cited nothing retrievable: the prose
    // may be fabricated, so we discard it for the canned miss fallback.
    const object = {
      kind: 'grounded',
      answer: 'A confident but uncited claim.',
      sources: [{ articleId: 'nope' }],
    }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    const result = await synthesizeAnswer({ query: 'q', articles: [article('kb_article_1')] })

    expect(result).toEqual({ kind: 'no_answer', answer: ASK_AI_MISS_FALLBACK, sources: [] })
  })

  it('passes numbered sources and the user query to chat()', async () => {
    const object = {
      kind: 'grounded',
      answer: 'A. [1]',
      sources: [{ articleId: 'kb_article_1' }],
    }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    await synthesizeAnswer({ query: 'my question', articles: [article('kb_article_1')] })

    const call = mockChat.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>
      systemPrompts: string[]
    }
    expect(call.messages).toEqual([{ role: 'user', content: 'my question' }])
    expect(call.systemPrompts.join('\n')).toContain('[1]')
  })

  it('retries once when the stream yields no validated object', async () => {
    const object = {
      kind: 'grounded',
      answer: 'Second try.',
      sources: [{ articleId: 'kb_article_1' }],
    }
    mockChat
      .mockReturnValueOnce(chunkStream([{ type: 'RUN_FINISHED', usage: undefined }]))
      .mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    const result = await synthesizeAnswer({ query: 'q', articles: [article('kb_article_1')] })
    expect(result.answer).toBe('Second try.')
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('fails after the retry also yields nothing', async () => {
    mockChat
      .mockReturnValueOnce(chunkStream([{ type: 'RUN_FINISHED' }]))
      .mockReturnValueOnce(chunkStream([{ type: 'RUN_FINISHED' }]))

    await expect(
      synthesizeAnswer({ query: 'q', articles: [article('kb_article_1')] })
    ).rejects.toThrow()
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('surfaces RUN_ERROR as a failure', async () => {
    // Fresh stream per attempt: both attempts fail with the provider error.
    mockChat.mockImplementation(() =>
      chunkStream([{ type: 'RUN_ERROR', message: 'provider exploded' }])
    )
    await expect(
      synthesizeAnswer({ query: 'q', articles: [article('kb_article_1')] })
    ).rejects.toThrow(/provider exploded/)
  })

  it('forwards a caller abort to the chat abort controller mid-run', async () => {
    const abort = new AbortController()
    let observedDuringRun: boolean | undefined
    const object = { kind: 'no_answer', answer: 'A.', sources: [] }
    mockChat.mockImplementationOnce((opts: { abortController: AbortController }) =>
      (async function* () {
        yield { type: 'TEXT_MESSAGE_CONTENT', delta: '{"answer": "A' }
        abort.abort()
        observedDuringRun = opts.abortController.signal.aborted
        yield {
          type: 'CUSTOM',
          name: 'structured-output.complete',
          value: { object, raw: JSON.stringify(object) },
        }
      })()
    )

    await synthesizeAnswer({
      query: 'q',
      articles: [article('kb_article_1')],
      signal: abort.signal,
    })

    expect(observedDuringRun).toBe(true)
  })

  it('logs usage with the retrieved article ids in metadata', async () => {
    const object = { kind: 'no_answer', answer: 'A.', sources: [] }
    mockChat.mockReturnValueOnce(chunkStream(completeRun(object, JSON.stringify(object))))

    await synthesizeAnswer({ query: 'q', articles: [article('kb_article_1')] })

    const [params] = mockWithUsageLogging.mock.calls[0]
    expect(params).toMatchObject({
      pipelineStep: 'help_center_answers',
      callType: 'chat_completion',
      model: 'test-model',
      metadata: { kbArticleIds: ['kb_article_1'] },
    })
  })
})
