import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KbArticleId } from '@quackback/ids'

const mockGetChatModel = vi.fn()
const mockGetHelpCenterConfig = vi.fn()
const mockGetArticleById = vi.fn()
const mockWriteTranslation = vi.fn()
const mockGetArticleTranslation = vi.fn()
const mockEnqueueHelpCenterTranslateJob = vi.fn()

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const mockChat = vi.fn()
vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (...args: unknown[]) => ({ kind: 'text', args }),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: (apiKey?: string, baseUrl?: string) => Boolean(apiKey) && Boolean(baseUrl),
  structuredOutputProviderOptions: () => ({}),
}))
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'ai-usage-logging' }),
}))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (...args: unknown[]) => mockGetChatModel(...args),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getHelpCenterConfig: () => mockGetHelpCenterConfig(),
}))
const mockWritePending = vi.fn()
vi.mock('../help-center-translation-versions.service', () => ({
  getArticleSourceForTranslation: async (...args: unknown[]) => {
    const article = await mockGetArticleById(...args)
    if (!article) return null
    return {
      revision: article.revision ?? 2,
      text: {
        title: article.title,
        description: article.description ?? null,
        content: article.content,
      },
      contentJson: article.contentJson ?? null,
      locale: 'en',
    }
  },
  writePendingTranslationUpdate: (...args: unknown[]) => mockWritePending(...args),
}))
vi.mock('../help-center-translations.service', () => ({
  getArticleTranslation: (...args: unknown[]) => mockGetArticleTranslation(...args),
  writeGuardedArticleTranslation: (...args: unknown[]) => mockWriteTranslation(...args),
}))
const budget = vi.hoisted(() => ({
  exhausted: false,
  windowEnd: new Date('2026-12-01T00:00:00.000Z'),
}))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)
vi.mock('@/lib/server/domains/ai/ai-budget', () => ({
  getAiBudgetStatus: async () => ({
    cap: 1000,
    used: budget.exhausted ? 1000 : 10,
    exhausted: budget.exhausted,
    window: { kind: 'month', start: new Date('2026-11-01T00:00:00.000Z'), end: budget.windowEnd },
  }),
}))
vi.mock('../help-center-translate-queue', () => ({
  enqueueHelpCenterTranslateJob: (...args: unknown[]) => mockEnqueueHelpCenterTranslateJob(...args),
}))

// The languages the plan holds back past its cap after the grace, as the real
// helper answers: the additional languages after the first (cap - 1).
const heldCap = vi.hoisted(() => ({ cap: null as number | null }))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.locales', () => ({
  heldHelpCenterLocales: async (additional: readonly string[]) =>
    heldCap.cap === null ? [] : additional.slice(Math.max(0, heldCap.cap - 1)),
}))

const { buildTranslationPrompt, translateArticleForLocale, runArticleTranslation } =
  await import('../help-center-auto-translate.service')
const { queueTranslationUpkeep } = await import('../help-center-translation-upkeep')
const published = (extra: Record<string, unknown> = {}) => ({
  id: 'article_1',
  textRevision: 3,
  publishedAt: new Date(),
  ...extra,
})
const upkeepKey = (locale: string) => ({ dedupeKey: `upkeep:article_1:${locale}:3` })
const { FEATURE_STATES, runsWithPlanGate, setFeatureState } =
  await import('@/lib/server/domains/plan-limits/__tests__/feature-states')

beforeEach(() => {
  vi.clearAllMocks()
  budget.exhausted = false
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockGetChatModel.mockReturnValue('gpt-test')
  mockGetArticleTranslation.mockResolvedValue(null)
  mockWriteTranslation.mockResolvedValue(true)
  mockWritePending.mockResolvedValue(true)
})

describe('buildTranslationPrompt', () => {
  it('includes the target locale and a strict JSON contract', () => {
    const { system } = buildTranslationPrompt({
      title: 'Refunds',
      description: null,
      content: '# Refunds\n\nHow to request one.',
      locale: 'de',
      protectedTerms: [],
    })
    expect(system).toContain('"de"')
    expect(system).toContain('"title"')
    expect(system).toContain('"content"')
  })

  it('instructs the model never to translate protected terms', () => {
    const { system } = buildTranslationPrompt({
      title: 'Refunds',
      description: null,
      content: 'Contact Quackback support.',
      locale: 'de',
      protectedTerms: ['Quackback', 'API'],
    })
    expect(system).toContain('Quackback, API')
    expect(system).toMatch(/never translate/i)
  })

  it('gives the fixed translation of each glossary word for the language', () => {
    const { system } = buildTranslationPrompt({
      title: 'Boards',
      description: null,
      content: 'Open a board.',
      locale: 'de',
      protectedTerms: [],
      fixedTranslations: [{ term: 'board', translation: 'Board' }],
    })
    expect(system).toContain('- board -> Board')
  })

  it('omits the glossary instruction when there are no protected terms', () => {
    const { system } = buildTranslationPrompt({
      title: 'Refunds',
      description: null,
      content: 'x',
      locale: 'de',
      protectedTerms: [],
    })
    expect(system).not.toMatch(/never translate/i)
  })

  it('carries the source content through as the user message', () => {
    const { user } = buildTranslationPrompt({
      title: 'Refunds',
      description: 'How to get one',
      content: 'Body text',
      locale: 'fr',
      protectedTerms: [],
    })
    const parsed = JSON.parse(user)
    expect(parsed).toEqual({
      title: 'Refunds',
      description: 'How to get one',
      content: 'Body text',
    })
  })
})

describe('translateArticleForLocale', () => {
  it('pauses before calling the model when the AI allowance is used up', async () => {
    budget.exhausted = true
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'x' })
    mockChat.mockResolvedValue({ title: 'T', content: 'C' })

    const result = await translateArticleForLocale('article_1' as KbArticleId, 'de')

    expect(result).toEqual({ pausedUntil: budget.windowEnd })
    expect(mockChat).not.toHaveBeenCalled()
    expect(mockWriteTranslation).not.toHaveBeenCalled()
  })

  it('stops translating into a language the plan holds back, and only that one', async () => {
    heldCap.cap = 2
    mockGetHelpCenterConfig.mockResolvedValue({
      autoTranslate: { protectedTerms: [] },
      locales: { default: 'en', additional: ['fr', 'de'], chrome: {} },
    })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'x' })
    mockChat.mockResolvedValue({ title: 'T', content: 'C' })
    try {
      expect(await translateArticleForLocale('article_1' as KbArticleId, 'de')).toBeUndefined()
      expect(mockChat).not.toHaveBeenCalled()
      expect(mockWriteTranslation).not.toHaveBeenCalled()

      await translateArticleForLocale('article_1' as KbArticleId, 'fr')
      expect(mockWriteTranslation).toHaveBeenCalledOnce()
    } finally {
      heldCap.cap = null
    }
  })

  it('translates normally while allowance remains', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'x' })
    mockChat.mockResolvedValue({ title: 'T', content: 'C' })

    const result = await translateArticleForLocale('article_1' as KbArticleId, 'de')

    expect(result).toBeUndefined()
    expect(mockChat).toHaveBeenCalledOnce()
    expect(mockWriteTranslation).toHaveBeenCalledOnce()
  })

  it('no-ops silently when AI is not configured', async () => {
    mockConfig.openaiApiKey = undefined
    mockGetChatModel.mockReturnValue(null)

    await translateArticleForLocale('article_1' as KbArticleId, 'de')

    expect(mockGetArticleById).not.toHaveBeenCalled()
    expect(mockWriteTranslation).not.toHaveBeenCalled()
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('writes a draft translation from the AI response', async () => {
    mockGetChatModel.mockReturnValue('gpt-test')
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: ['Quackback'] } })
    mockGetArticleById.mockResolvedValue({
      title: 'Refunds',
      description: 'How to get one',
      content: 'Contact Quackback support.',
    })
    mockChat.mockResolvedValue({
      title: 'Rückerstattungen',
      description: 'Wie man eine bekommt',
      content: 'Kontaktieren Sie den Quackback-Support.',
    })

    await translateArticleForLocale('article_1' as KbArticleId, 'de')

    expect(mockWriteTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: 'article_1',
        locale: 'de',
        title: 'Rückerstattungen',
        description: 'Wie man eine bekommt',
        content: 'Kontaktieren Sie den Quackback-Support.',
      }),
      null
    )
  })

  it('leaves a translation that is current with the article, without calling the AI', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'x' })
    mockGetArticleTranslation.mockResolvedValue({
      status: 'published',
      title: 'Rückerstattungen',
      sourceRevision: 2,
      pendingTitle: null,
      pendingSourceRevision: null,
      checkResult: null,
    })

    expect(await runArticleTranslation('article_1' as KbArticleId, 'de')).toEqual({
      kind: 'skipped',
      reason: 'current',
    })
    expect(mockChat).not.toHaveBeenCalled()
    expect(mockWriteTranslation).not.toHaveBeenCalled()
    expect(mockWritePending).not.toHaveBeenCalled()
  })

  it('gives a translation behind its article a waiting update, never touching its live text', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({
      title: 'Refunds',
      description: 'How to get one',
      content: 'Ask us.',
      revision: 5,
    })
    mockGetArticleTranslation.mockResolvedValue({
      status: 'published',
      title: 'Rückerstattungen',
      sourceRevision: 4,
      pendingTitle: null,
      pendingSourceRevision: null,
      checkResult: null,
    })
    mockChat.mockResolvedValue({ title: 'Erstattungen', description: 'Wie', content: 'Frag uns.' })

    const outcome = await runArticleTranslation('article_1' as KbArticleId, 'de')

    expect(outcome).toEqual({ kind: 'update', check: { ok: true, problems: [] } })
    expect(mockWriteTranslation).not.toHaveBeenCalled()
    expect(mockWritePending).toHaveBeenCalledWith(
      'article_1',
      'de',
      expect.objectContaining({
        title: 'Erstattungen',
        description: 'Wie',
        content: 'Frag uns.',
        sourceRevision: 5,
        sourceText: { title: 'Refunds', description: 'How to get one', content: 'Ask us.' },
      })
    )
  })

  it('leaves an update already waiting for this version, unless a person asks again after a failed check', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'x' })
    const waiting = {
      status: 'published',
      title: 'Rückerstattungen',
      sourceRevision: 1,
      pendingTitle: 'Erstattungen',
      pendingSourceRevision: 2,
      checkResult: { ok: false, problems: [{ code: 'empty' }] },
    }
    mockGetArticleTranslation.mockResolvedValue(waiting)
    mockChat.mockResolvedValue({ title: 'T', content: 'C' })

    expect(await runArticleTranslation('article_1' as KbArticleId, 'de')).toEqual({
      kind: 'skipped',
      reason: 'update_waiting',
    })
    expect(mockChat).not.toHaveBeenCalled()

    const asked = await runArticleTranslation('article_1' as KbArticleId, 'de', { mode: 'request' })
    expect(asked.kind).toBe('update')
    expect(mockChat).toHaveBeenCalledOnce()

    mockGetArticleTranslation.mockResolvedValue({
      ...waiting,
      checkResult: { ok: true, problems: [] },
    })
    expect(
      await runArticleTranslation('article_1' as KbArticleId, 'de', { mode: 'request' })
    ).toEqual({ kind: 'skipped', reason: 'update_waiting' })
  })

  it('never sends code or link targets to the model, and puts them back', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({
      title: 'Export',
      description: null,
      content: '',
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Open ' },
              {
                type: 'text',
                text: 'settings',
                marks: [{ type: 'link', attrs: { href: 'https://example.com/settings' } }],
              },
              { type: 'text', text: ' and run ' },
              { type: 'text', text: 'qb export', marks: [{ type: 'code' }] },
            ],
          },
          {
            type: 'codeBlock',
            attrs: { language: 'bash' },
            content: [{ type: 'text', text: 'curl https://example.com/api' }],
          },
        ],
      },
    })
    // The model echoes the tokens it was given.
    mockChat.mockImplementation(async (args: { messages: { content: string }[] }) => {
      const sent = JSON.parse(args.messages[0].content) as { content: string }
      return {
        title: 'Exportieren',
        content: sent.content.replace('Open', 'Öffne').replace('and run', 'und führe aus'),
      }
    })

    const outcome = await runArticleTranslation('article_1' as KbArticleId, 'de')

    const sent = JSON.parse(mockChat.mock.calls[0][0].messages[0].content).content as string
    expect(sent).not.toContain('example.com')
    expect(sent).not.toContain('qb export')
    expect(sent).not.toContain('curl')
    expect(outcome).toEqual({ kind: 'draft', check: { ok: true, problems: [] } })
    const written = mockWriteTranslation.mock.calls[0][0]
    expect(written.content).toContain('[settings](https://example.com/settings)')
    expect(written.content).toContain('`qb export`')
    expect(written.content).toContain('curl https://example.com/api')
    expect(written.checkResult).toEqual({ ok: true, problems: [] })
  })

  it('stores a translation that lost a link with a failed check, as a draft only', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({
      title: 'Export',
      description: null,
      content: 'See [the guide](https://example.com/guide).',
    })
    mockChat.mockResolvedValue({ title: 'Exportieren', content: 'Siehe die Anleitung.' })

    const outcome = await runArticleTranslation('article_1' as KbArticleId, 'de')

    expect(outcome).toEqual({
      kind: 'draft',
      check: {
        ok: false,
        problems: [{ code: 'link_missing', detail: 'https://example.com/guide' }],
      },
    })
    expect(mockWriteTranslation.mock.calls[0][0].checkResult.ok).toBe(false)
  })

  it('keeps a version a person saved while the AI call ran', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'Hi.' })
    mockChat.mockResolvedValue({ title: 'Erstattung', description: '', content: 'Hallo.' })
    mockWriteTranslation.mockResolvedValue(false)

    await translateArticleForLocale('article_1' as KbArticleId, 'de')

    // Insert-only: the write is told there was no version, so it never updates one.
    expect(mockWriteTranslation).toHaveBeenCalledOnce()
    expect(mockWriteTranslation.mock.calls[0][1]).toBeNull()
  })

  it('does not throw and does not write when the AI response is unparseable', async () => {
    // With outputSchema, chat() validates and rejects on a non-conforming
    // response; the surrounding try/catch logs and returns without writing.
    mockGetChatModel.mockReturnValue('gpt-test')
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'x' })
    mockChat.mockRejectedValue(new Error('response did not match schema'))

    await expect(
      translateArticleForLocale('article_1' as KbArticleId, 'de')
    ).resolves.toBeUndefined()
    expect(mockWriteTranslation).not.toHaveBeenCalled()
  })

  it('does not throw and does not write when the AI response is incomplete', async () => {
    mockGetChatModel.mockReturnValue('gpt-test')
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'x' })
    mockChat.mockResolvedValue({ title: '', content: '' })

    await expect(
      translateArticleForLocale('article_1' as KbArticleId, 'de')
    ).resolves.toBeUndefined()
    expect(mockWriteTranslation).not.toHaveBeenCalled()
  })
})

describe('queueTranslationUpkeep', () => {
  it('does nothing when auto-translate is disabled', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({
      autoTranslate: { enabled: false },
      locales: { additional: ['de', 'fr'] },
    })

    await queueTranslationUpkeep(published())

    expect(mockEnqueueHelpCenterTranslateJob).not.toHaveBeenCalled()
  })

  it('does nothing when no additional locale is enabled', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({
      autoTranslate: { enabled: true },
      locales: { additional: [] },
    })

    await queueTranslationUpkeep(published())

    expect(mockEnqueueHelpCenterTranslateJob).not.toHaveBeenCalled()
  })

  it('queues one job per enabled additional locale, keyed by the article revision', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({
      autoTranslate: { enabled: true },
      locales: { additional: ['de', 'fr'] },
    })

    await queueTranslationUpkeep(published())

    expect(mockEnqueueHelpCenterTranslateJob).toHaveBeenCalledTimes(2)
    expect(mockEnqueueHelpCenterTranslateJob).toHaveBeenCalledWith(
      { type: 'translate-article', articleId: 'article_1', locale: 'de' },
      upkeepKey('de')
    )
    expect(mockEnqueueHelpCenterTranslateJob).toHaveBeenCalledWith(
      { type: 'translate-article', articleId: 'article_1', locale: 'fr' },
      upkeepKey('fr')
    )
  })

  it('drafts an article left in a former main language into the main language, never its own', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({
      autoTranslate: { enabled: true },
      locales: { default: 'de', additional: ['fr', 'en'] },
    })

    await queueTranslationUpkeep(published({ locale: 'en' }))

    expect(mockEnqueueHelpCenterTranslateJob.mock.calls.map(([job]) => job.locale).sort()).toEqual([
      'de',
      'fr',
    ])
  })

  it('does nothing for an article that is not published', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({
      autoTranslate: { enabled: true },
      locales: { additional: ['de'] },
    })

    await queueTranslationUpkeep(published({ publishedAt: null }))

    expect(mockEnqueueHelpCenterTranslateJob).not.toHaveBeenCalled()
  })

  it('swallows enqueue errors rather than throwing (never blocks publish)', async () => {
    mockGetHelpCenterConfig.mockRejectedValue(new Error('settings unavailable'))

    await expect(queueTranslationUpkeep(published())).resolves.toBeUndefined()
  })
})

// The plan gate reads isFeatureLive: the plan's own answer without plan billing, kept
// live through the plan limits grace, off after it.
describe('AI article translation and the plan limits pause', () => {
  beforeEach(() => setFeatureState('tierOff'))

  it.each(FEATURE_STATES)('translates in the %s state only while live', async (state) => {
    setFeatureState(state, 'aiArticleTranslation')
    mockGetHelpCenterConfig.mockResolvedValue({ autoTranslate: { protectedTerms: [] } })
    mockGetArticleById.mockResolvedValue({ title: 'Refunds', description: null, content: 'x' })
    mockChat.mockResolvedValue({ title: 'T', content: 'C' })

    const result = await translateArticleForLocale('article_1' as KbArticleId, 'de')

    expect(result).toBeUndefined()
    if (runsWithPlanGate(state)) {
      expect(mockChat).toHaveBeenCalled()
    } else {
      expect(mockChat).not.toHaveBeenCalled()
      expect(mockWriteTranslation).not.toHaveBeenCalled()
    }
  })

  it.each(FEATURE_STATES)('queues on publish in the %s state only while live', async (state) => {
    setFeatureState(state, 'aiArticleTranslation')
    mockGetHelpCenterConfig.mockResolvedValue({
      autoTranslate: { enabled: true },
      locales: { additional: ['de', 'fr'] },
    })

    await queueTranslationUpkeep(published())

    expect(mockEnqueueHelpCenterTranslateJob).toHaveBeenCalledTimes(runsWithPlanGate(state) ? 2 : 0)
  })
})
