/**
 * P2-D.1 two-way inbox translation service behavior: language-tag helpers,
 * lazy customer-language detection, the incoming cache-hit/fresh-translate
 * path (which must never touch conversation_messages), the outgoing
 * translate-or-block path, and the activation toggle/dismiss persistence.
 * AI calls are mocked at the same module boundaries as
 * help-center-auto-translate.service.test.ts so these stay fast and
 * deterministic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import type { Conversation, ConversationMessage } from '@/lib/server/db'

const mockGetChatModel = vi.fn()
const publishConversationUpdate = vi.fn()
const conversationToDTO = vi.fn(async (c: { id: string }) => ({ id: c.id }))

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const budget = vi.hoisted(() => ({
  exhausted: false,
  windowStart: new Date('2026-11-01T00:00:00.000Z'),
}))
vi.mock('@/lib/server/domains/ai/ai-budget', () => ({
  getAiBudgetStatus: async () => ({
    cap: 1000,
    used: budget.exhausted ? 1200 : 10,
    exhausted: budget.exhausted,
    window: {
      kind: 'month',
      start: budget.windowStart,
      end: new Date(budget.windowStart.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  }),
}))

const logged = vi.hoisted(() => ({ warn: [] as Array<{ ctx: unknown; msg: unknown }> }))
vi.mock('@/lib/server/logger', () => {
  const noop = () => {}
  const make = (): Record<string, unknown> => ({
    trace: noop,
    debug: noop,
    info: noop,
    error: noop,
    fatal: noop,
    warn: (ctx: unknown, msg: unknown) => logged.warn.push({ ctx, msg }),
    child: () => make(),
  })
  return { logger: make() }
})

const mockChat = vi.fn()
vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => {
    const onWrite = usageWrite.onWrite
    usageWrite.pending = onWrite
      ? new Promise<void>((resolve) =>
          setTimeout(() => {
            onWrite()
            resolve()
          }, 5)
        )
      : Promise.resolve()
    return mockChat(...args)
  },
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (...args: unknown[]) => ({ kind: 'text', args }),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: (apiKey?: string, baseUrl?: string) => Boolean(apiKey) && Boolean(baseUrl),
  structuredOutputProviderOptions: () => ({}),
}))
// Stands in for the usage row write: chat() starts it, settled() awaits it.
const usageWrite = vi.hoisted(() => ({
  pending: Promise.resolve() as Promise<void>,
  onWrite: null as null | (() => void),
}))
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({
    name: 'ai-usage-logging',
    settled: () => usageWrite.pending,
  }),
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (...args: unknown[]) => mockGetChatModel(...args),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: (...a: unknown[]) => publishConversationUpdate(...a),
}))
vi.mock('../conversation.query', () => ({
  conversationToDTO: (...a: [{ id: string }]) => conversationToDTO(...a),
  // A faithful stand-in for the real (pure) projection — this suite's own
  // `describe('translationStateFrom', ...)` block below exercises the real
  // implementation directly (imported from ../conversation.query at the
  // bottom via re-export), so this mock only needs to unblock the service's
  // internal import.
  translationStateFrom: (c: {
    translationEnabled?: boolean
    detectedCustomerLanguage?: string | null
    translationDismissedAt?: Date | null
  }) => ({
    enabled: c.translationEnabled ?? false,
    detectedCustomerLanguage: c.detectedCustomerLanguage ?? null,
    suggestionDismissed: c.translationDismissedAt != null,
  }),
}))

// In-memory fakes driving the db mock below.
let conversationRow: Record<string, unknown> | undefined
let messageRows: Array<{ content: string }>
let cachedTranslationRow: Record<string, unknown> | undefined
let teammateRow: Record<string, unknown> | undefined
let updateReturns: Record<string, unknown>[]
const insertedTranslations: Record<string, unknown>[] = []
const setPayloads: Record<string, unknown>[] = []

type SelectKind = 'conversation' | 'messages' | 'translation' | 'user'

vi.mock('@/lib/server/db', async (importOriginal) => {
  function selectChain(kind: SelectKind): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.from = () => c
    c.where = () => c
    c.orderBy = () => c
    c.limit = async () => {
      if (kind === 'conversation') return conversationRow ? [conversationRow] : []
      if (kind === 'messages') return messageRows
      if (kind === 'user') return teammateRow ? [teammateRow] : []
      return cachedTranslationRow ? [cachedTranslationRow] : []
    }
    return c
  }
  function updateChain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.set = (payload: Record<string, unknown>) => {
      setPayloads.push(payload)
      return c
    }
    c.where = () => c
    c.returning = async () => updateReturns
    return c
  }
  function insertChain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.values = (payload: Record<string, unknown>) => {
      insertedTranslations.push(payload)
      return c
    }
    c.onConflictDoUpdate = async () => undefined
    return c
  }
  // Route `db.select().from(table)` to the right in-memory fixture by
  // inspecting which table object is passed to `.from`.
  const real = await importOriginal<typeof import('@/lib/server/db')>()
  const db = {
    select: (..._cols: unknown[]) => ({
      from: (table: unknown) => {
        const kind: SelectKind =
          table === real.conversationMessageTranslations
            ? 'translation'
            : table === real.conversationMessages
              ? 'messages'
              : table === real.user
                ? 'user'
                : 'conversation'
        return selectChain(kind)
      },
    }),
    update: () => updateChain(),
    insert: () => insertChain(),
  }
  return { ...real, db }
})

const {
  primaryLanguageSubtag,
  sameLanguage,
  buildLanguageDetectionPrompt,
  buildInboxTranslationPrompt,
  maybeDetectCustomerLanguage,
  translateIncomingMessage,
  translateOutgoingContent,
  resolveOutgoingReplyTranslation,
  getInboxTranslationContext,
  setInboxTranslationEnabled,
  dismissInboxTranslationSuggestion,
  TranslationUnavailableError,
  TranslationRichContentError,
  inboxTranslationOverAllowance,
} = await import('../conversation-translation.service')
const { UNDETERMINED_LANGUAGE } = await import('@/lib/shared/conversation/translation')

const conversationId = 'conversation_1' as ConversationId
const messageId = 'conversation_msg_1' as ConversationMessageId

const agent: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}
const visitor: Actor = {
  principalId: 'principal_v' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

function makeConversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: conversationId,
    detectedCustomerLanguage: null,
    translationEnabled: false,
    translationDismissedAt: null,
    ...over,
  } as unknown as Conversation
}

beforeEach(() => {
  vi.clearAllMocks()
  budget.exhausted = false
  usageWrite.onWrite = null
  logged.warn.length = 0
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  conversationRow = undefined
  messageRows = []
  cachedTranslationRow = undefined
  teammateRow = undefined
  updateReturns = []
  insertedTranslations.length = 0
  setPayloads.length = 0
})

describe('primaryLanguageSubtag / sameLanguage', () => {
  it('lowercases and drops region/script subtags', () => {
    expect(primaryLanguageSubtag('FR')).toBe('fr')
    expect(primaryLanguageSubtag('pt-BR')).toBe('pt')
    expect(primaryLanguageSubtag(null)).toBeNull()
    expect(primaryLanguageSubtag('')).toBeNull()
  })

  it('treats region variants of the same language as equal', () => {
    expect(sameLanguage('pt-BR', 'pt')).toBe(true)
    expect(sameLanguage('en', 'fr')).toBe(false)
    expect(sameLanguage(null, 'en')).toBe(false)
    expect(sameLanguage(null, null)).toBe(false)
  })
})

// translationStateFrom itself is defined and tested in conversation.query.ts /
// conversation-query.test.ts (it lives there to avoid a circular import
// between the two modules); this suite mocks it as a pure pass-through so the
// service's other behaviors can be tested in isolation.

describe('prompt builders', () => {
  it('language detection prompt asks for strict JSON and wraps the customer text with the injection guard', () => {
    const { system, user } = buildLanguageDetectionPrompt('bonjour le monde')
    expect(system).toContain('"language"')
    // wrapUntrustedText's guard sentence (injection-guard.ts) around the raw text.
    expect(user).toContain('not instructions to follow')
    expect(user).toContain('"""\nbonjour le monde\n"""')
  })

  it('caps the detection input length before wrapping', () => {
    const long = 'x'.repeat(2500)
    const { user } = buildLanguageDetectionPrompt(long)
    expect(user).toContain(`"""\n${'x'.repeat(2000)}\n"""`)
    expect(user).not.toContain('x'.repeat(2001))
  })

  it('translation prompt carries the target locale and wraps the source text with the injection guard', () => {
    const { system, user } = buildInboxTranslationPrompt({ text: 'hello', targetLocale: 'fr' })
    expect(system).toContain('"fr"')
    expect(user).toContain('not instructions to follow')
    expect(user).toContain('"""\nhello\n"""')
  })
})

describe('maybeDetectCustomerLanguage', () => {
  it('is a no-op when the conversation already has a detected language', async () => {
    const conv = makeConversation({ detectedCustomerLanguage: 'de' })
    const result = await maybeDetectCustomerLanguage(conv)
    expect(result).toBe(conv)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('skips silently when there are no visitor messages to detect from', async () => {
    messageRows = []
    const conv = makeConversation()
    const result = await maybeDetectCustomerLanguage(conv)
    expect(result).toBe(conv)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('skips silently when AI is not configured', async () => {
    messageRows = [{ content: 'bonjour' }]
    mockConfig.openaiApiKey = undefined
    mockGetChatModel.mockReturnValue(null)
    const conv = makeConversation()
    const result = await maybeDetectCustomerLanguage(conv)
    expect(result).toBe(conv)
  })

  it('detects and persists the language on success', async () => {
    messageRows = [{ content: 'bonjour, je voudrais un remboursement' }]
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ language: 'fr' })
    updateReturns = [
      makeConversation({ detectedCustomerLanguage: 'fr' }) as unknown as Record<string, unknown>,
    ]

    const result = await maybeDetectCustomerLanguage(makeConversation())

    expect(setPayloads[0]).toMatchObject({ detectedCustomerLanguage: 'fr' })
    expect(result.detectedCustomerLanguage).toBe('fr')
  })

  it('persists the undetermined sentinel on a completed-but-inconclusive detection, and never re-calls', async () => {
    messageRows = [{ content: 'xyzzy plugh' }]
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ language: null })
    updateReturns = [
      makeConversation({
        detectedCustomerLanguage: UNDETERMINED_LANGUAGE,
      }) as unknown as Record<string, unknown>,
    ]

    const result = await maybeDetectCustomerLanguage(makeConversation())

    expect(setPayloads[0]).toMatchObject({ detectedCustomerLanguage: UNDETERMINED_LANGUAGE })
    expect(result.detectedCustomerLanguage).toBe(UNDETERMINED_LANGUAGE)

    // A conversation that already carries the sentinel short-circuits forever
    // after, exactly like a real detected language — no second AI call.
    vi.clearAllMocks()
    const again = await maybeDetectCustomerLanguage(
      makeConversation({ detectedCustomerLanguage: UNDETERMINED_LANGUAGE })
    )
    expect(again.detectedCustomerLanguage).toBe(UNDETERMINED_LANGUAGE)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('swallows an unparseable AI response and returns the conversation unchanged', async () => {
    // With outputSchema, chat() throws on a non-conforming response; the
    // surrounding try/catch in maybeDetectCustomerLanguage logs and swallows it.
    messageRows = [{ content: 'bonjour' }]
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockRejectedValue(new Error('response did not match schema'))

    const conv = makeConversation()
    const result = await maybeDetectCustomerLanguage(conv)
    expect(result).toBe(conv)
    expect(setPayloads).toHaveLength(0)
  })

  it('swallows a thrown AI error and returns the conversation unchanged', async () => {
    messageRows = [{ content: 'bonjour' }]
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockRejectedValue(new Error('network blip'))

    const conv = makeConversation()
    await expect(maybeDetectCustomerLanguage(conv)).resolves.toBe(conv)
  })
})

describe('translateIncomingMessage', () => {
  const message: Pick<ConversationMessage, 'id' | 'content'> = {
    id: messageId,
    content: 'Bonjour, mon colis est en retard.',
  }

  it('returns the cached translation without calling the AI (cache hit)', async () => {
    cachedTranslationRow = { content: 'Hello, my package is late.', locale: 'en' }

    const result = await translateIncomingMessage(message, 'en')

    expect(result).toEqual({ content: 'Hello, my package is late.', cached: true })
    expect(mockChat).not.toHaveBeenCalled()
    expect(insertedTranslations).toHaveLength(0)
  })

  it('translates and writes the cache row on a miss (fresh translation)', async () => {
    cachedTranslationRow = undefined
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'Hello, my package is late.' })

    const result = await translateIncomingMessage(message, 'en')

    expect(result).toEqual({ content: 'Hello, my package is late.', cached: false })
    expect(insertedTranslations).toEqual([
      expect.objectContaining({
        conversationMessageId: messageId,
        locale: 'en',
        content: 'Hello, my package is late.',
      }),
    ])
  })

  it('never mutates conversation_messages — only the translation cache table is written', async () => {
    cachedTranslationRow = undefined
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'translated' })

    await translateIncomingMessage(message, 'en')

    // The only `update()` calls this service issues are on `conversations`
    // (detection / activation); a display translation never calls update at
    // all, so `conversation_messages` — which has no update path here in the
    // first place — cannot have been touched.
    expect(setPayloads).toHaveLength(0)
  })

  it('throws TranslationUnavailableError when AI is not configured', async () => {
    cachedTranslationRow = undefined
    mockConfig.openaiApiKey = undefined
    mockGetChatModel.mockReturnValue(null)

    await expect(translateIncomingMessage(message, 'en')).rejects.toBeInstanceOf(
      TranslationUnavailableError
    )
    expect(insertedTranslations).toHaveLength(0)
  })

  it('throws TranslationUnavailableError on an unparseable AI response', async () => {
    // With outputSchema, chat() throws on a non-conforming response where the
    // old code had a JSON.parse catch branch; the surrounding try/catch here
    // converts either into the same TranslationUnavailableError.
    cachedTranslationRow = undefined
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockRejectedValue(new Error('response did not match schema'))

    await expect(translateIncomingMessage(message, 'en')).rejects.toBeInstanceOf(
      TranslationUnavailableError
    )
  })
})

describe('translateOutgoingContent', () => {
  it('returns the translated text on success', async () => {
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'Bonjour, comment puis-je aider?' })

    const result = await translateOutgoingContent('Hi, how can I help?', 'fr')
    expect(result).toBe('Bonjour, comment puis-je aider?')
  })

  it('throws TranslationUnavailableError when AI is not configured (blocks the send)', async () => {
    mockConfig.openaiApiKey = undefined
    mockGetChatModel.mockReturnValue(null)

    await expect(translateOutgoingContent('Hi', 'fr')).rejects.toBeInstanceOf(
      TranslationUnavailableError
    )
  })

  it('throws TranslationUnavailableError when the AI response has no content', async () => {
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({})

    await expect(translateOutgoingContent('Hi', 'fr')).rejects.toBeInstanceOf(
      TranslationUnavailableError
    )
  })
})

describe('getInboxTranslationContext', () => {
  it('returns the enabled flag and detected customer locale', async () => {
    conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'fr' }
    const ctx = await getInboxTranslationContext(conversationId)
    expect(ctx).toEqual({ enabled: true, customerLocale: 'fr' })
  })

  it('returns null when the conversation does not exist', async () => {
    conversationRow = undefined
    const ctx = await getInboxTranslationContext(conversationId)
    expect(ctx).toBeNull()
  })

  it('treats the undetermined sentinel as no real customer locale', async () => {
    conversationRow = { translationEnabled: true, detectedCustomerLanguage: UNDETERMINED_LANGUAGE }
    const ctx = await getInboxTranslationContext(conversationId)
    expect(ctx).toEqual({ enabled: true, customerLocale: null })
  })
})

describe('resolveOutgoingReplyTranslation', () => {
  const teammateUserId = 'user_1' as never
  const baseInput = () => ({
    conversationId,
    content: 'Hi, how can I help?',
    contentJson: { type: 'doc', content: [] } as unknown as null,
    teammateUserId,
  })

  it('passes content through untouched when translation is not enabled', async () => {
    conversationRow = { translationEnabled: false, detectedCustomerLanguage: 'fr' }
    const result = await resolveOutgoingReplyTranslation(baseInput())
    expect(result).toEqual({ content: baseInput().content, contentJson: baseInput().contentJson })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('passes content through untouched when no customer language has been detected yet', async () => {
    conversationRow = { translationEnabled: true, detectedCustomerLanguage: null }
    const result = await resolveOutgoingReplyTranslation(baseInput())
    expect(result.translatedFrom).toBeUndefined()
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('passes content through untouched when there is no text to translate', async () => {
    conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'fr' }
    const result = await resolveOutgoingReplyTranslation({ ...baseInput(), content: '   ' })
    expect(result.content).toBe('   ')
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('skips translation when the teammate already writes in the customer language', async () => {
    conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'en' }
    teammateRow = { preferredLanguage: 'en' }
    const result = await resolveOutgoingReplyTranslation(baseInput())
    expect(result).toEqual({ content: baseInput().content, contentJson: baseInput().contentJson })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('translates and preserves the original when languages differ (outgoing send)', async () => {
    conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'fr' }
    teammateRow = { preferredLanguage: 'en' }
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'Bonjour, comment puis-je aider?' })

    const result = await resolveOutgoingReplyTranslation(baseInput())

    expect(result.content).toBe('Bonjour, comment puis-je aider?')
    // Rich formatting is not preserved through a translated send.
    expect(result.contentJson).toBeNull()
    expect(result.translatedFrom).toEqual({
      originalContent: 'Hi, how can I help?',
      sourceLocale: 'en',
      targetLocale: 'fr',
    })
  })

  it('defaults the teammate locale to "en" when no preference is set', async () => {
    conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'fr' }
    teammateRow = { preferredLanguage: null }
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'x' })

    const result = await resolveOutgoingReplyTranslation(baseInput())
    expect(result.translatedFrom?.sourceLocale).toBe('en')
  })

  it('throws TranslationUnavailableError (BLOCKS the send) when the AI call fails', async () => {
    conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'fr' }
    teammateRow = { preferredLanguage: 'en' }
    mockConfig.openaiApiKey = undefined
    mockGetChatModel.mockReturnValue(null)

    await expect(resolveOutgoingReplyTranslation(baseInput())).rejects.toBeInstanceOf(
      TranslationUnavailableError
    )
  })

  describe('rich content (images/embeds) blocking', () => {
    const richContentJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Look:' }] },
        { type: 'resizableImage', attrs: { src: 'https://cdn.example.com/x.png' } },
      ],
    } as unknown as null

    it('BLOCKS (TranslationRichContentError) an inline image, before calling the model', async () => {
      conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'fr' }
      teammateRow = { preferredLanguage: 'en' }

      await expect(
        resolveOutgoingReplyTranslation({ ...baseInput(), contentJson: richContentJson })
      ).rejects.toBeInstanceOf(TranslationRichContentError)
      expect(mockChat).not.toHaveBeenCalled()
    })

    it('still translates a plain-text send with no image/embed, exactly as before', async () => {
      conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'fr' }
      teammateRow = { preferredLanguage: 'en' }
      mockGetChatModel.mockReturnValue('gpt-test')
      mockChat.mockResolvedValue({ content: 'Bonjour' })

      const plainTextDoc = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi, how can I help?' }] }],
      } as unknown as null

      const result = await resolveOutgoingReplyTranslation({
        ...baseInput(),
        contentJson: plainTextDoc,
      })
      expect(result.content).toBe('Bonjour')
      expect(result.contentJson).toBeNull()
    })

    it('does not block a rich send when translation would not actually run (same language)', async () => {
      conversationRow = { translationEnabled: true, detectedCustomerLanguage: 'en' }
      teammateRow = { preferredLanguage: 'en' }

      const result = await resolveOutgoingReplyTranslation({
        ...baseInput(),
        contentJson: richContentJson,
      })
      expect(result.contentJson).toEqual(richContentJson)
      expect(mockChat).not.toHaveBeenCalled()
    })
  })
})

describe('setInboxTranslationEnabled (activation toggle persistence)', () => {
  it('persists enabled=true and clears any prior dismissal', async () => {
    conversationRow = makeConversation({ translationDismissedAt: new Date() }) as unknown as Record<
      string,
      unknown
    >
    updateReturns = [
      makeConversation({ translationEnabled: true }) as unknown as Record<string, unknown>,
    ]

    await setInboxTranslationEnabled(conversationId, true, agent)

    expect(setPayloads[0]).toMatchObject({ translationEnabled: true, translationDismissedAt: null })
    expect(publishConversationUpdate).toHaveBeenCalledTimes(1)
  })

  it('persists enabled=false without touching an existing dismissal', async () => {
    const dismissedAt = new Date('2026-01-01T00:00:00.000Z')
    conversationRow = makeConversation({
      translationDismissedAt: dismissedAt,
    }) as unknown as Record<string, unknown>
    updateReturns = [
      makeConversation({ translationEnabled: false }) as unknown as Record<string, unknown>,
    ]

    await setInboxTranslationEnabled(conversationId, false, agent)

    expect(setPayloads[0]).toMatchObject({
      translationEnabled: false,
      translationDismissedAt: dismissedAt,
    })
  })

  it('refuses a non-agent actor', async () => {
    await expect(setInboxTranslationEnabled(conversationId, true, visitor)).rejects.toThrow()
    expect(publishConversationUpdate).not.toHaveBeenCalled()
  })

  it('404s on a missing conversation', async () => {
    conversationRow = undefined
    await expect(setInboxTranslationEnabled(conversationId, true, agent)).rejects.toThrow(
      /not found/i
    )
  })
})

describe('dismissInboxTranslationSuggestion (activation dismiss persistence)', () => {
  it('sets a dismissal timestamp', async () => {
    conversationRow = makeConversation() as unknown as Record<string, unknown>
    updateReturns = [
      makeConversation({ translationDismissedAt: new Date() }) as unknown as Record<
        string,
        unknown
      >,
    ]

    await dismissInboxTranslationSuggestion(conversationId, agent)

    expect(setPayloads[0].translationDismissedAt).toBeInstanceOf(Date)
    expect(publishConversationUpdate).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-agent actor', async () => {
    await expect(dismissInboxTranslationSuggestion(conversationId, visitor)).rejects.toThrow()
  })
})

describe('inbox translation over the AI allowance', () => {
  const overAllowanceWarnings = () =>
    logged.warn.filter((w) => String(w.msg).includes('AI allowance'))

  it('keeps translating, and says so, once the allowance is used up', async () => {
    budget.exhausted = true
    budget.windowStart = new Date('2026-07-01T00:00:00.000Z')
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'Bonjour' })

    await expect(translateOutgoingContent('Hello', 'fr')).resolves.toBe('Bonjour')
    expect(mockChat).toHaveBeenCalledOnce()
    expect(await inboxTranslationOverAllowance()).toBe(true)
  })

  it('warns once per allowance window, not once per call', async () => {
    budget.exhausted = true
    budget.windowStart = new Date('2026-08-01T00:00:00.000Z')
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'Bonjour' })

    await translateOutgoingContent('Hello', 'fr')
    await translateOutgoingContent('Hello again', 'fr')
    await inboxTranslationOverAllowance()
    expect(overAllowanceWarnings()).toHaveLength(1)

    budget.windowStart = new Date('2026-09-01T00:00:00.000Z')
    await inboxTranslationOverAllowance()
    expect(overAllowanceWarnings()).toHaveLength(2)
  })

  it('is quiet while allowance remains', async () => {
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'Bonjour' })
    await translateOutgoingContent('Hello', 'fr')
    expect(await inboxTranslationOverAllowance()).toBe(false)
    expect(overAllowanceWarnings()).toHaveLength(0)
  })

  it('a call that crosses the allowance is reflected straight after it returns', async () => {
    budget.windowStart = new Date('2026-10-01T00:00:00.000Z')
    mockGetChatModel.mockReturnValue('gpt-test')
    mockChat.mockResolvedValue({ content: 'Bonjour' })
    // This call's own usage row is what takes the workspace over the cap.
    usageWrite.onWrite = () => {
      budget.exhausted = true
    }

    await translateOutgoingContent('Hello', 'fr')
    expect(await inboxTranslationOverAllowance()).toBe(true)
  })
})
