/**
 * Automatic translation upkeep against the real tables and job_queue (rolled
 * back): a text change on a published article queues one job per language
 * and revision, the job gives a translation behind its article an update
 * that waits beside its unchanged live text, and the daily catch-up queues
 * only translations still behind.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type KbArticleId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  inArray,
  principal,
  sql,
} from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const state = vi.hoisted(() => ({ enabled: true, modelCalls: 0 }))

vi.mock('@/lib/server/domains/ai/ai-budget', () => ({
  getAiBudgetStatus: async () => ({
    cap: 1000,
    used: 0,
    exhausted: false,
    window: { kind: 'month', start: new Date(0), end: new Date(Date.now() + 86_400_000) },
  }),
}))
vi.mock('@/lib/server/config', () => ({
  config: { openaiApiKey: 'test-key', openaiBaseUrl: 'http://127.0.0.1:9/v1' },
}))
vi.mock('@/lib/server/domains/ai/models', () => ({ getChatModel: () => 'test-model' }))
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'ai-usage-logging' }),
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({ openaiCompatibleText: () => ({}) }))
vi.mock('@tanstack/ai', () => ({
  chat: async () => {
    state.modelCalls++
    return { title: 'Erstattungen (KI)', content: 'Wie Erstattungen jetzt funktionieren.' }
  },
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  isFeatureLive: async () => true,
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.locales', () => ({
  heldHelpCenterLocales: async () => [],
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getHelpCenterConfig: async () => ({
    autoTranslate: { enabled: state.enabled, protectedTerms: [], fixedTranslations: {} },
    locales: { default: 'en', additional: ['de', 'fr'], chrome: {} },
  }),
  getMainLanguage: async () => 'en',
}))
vi.mock('../help-center-embedding.service', () => ({ generateArticleEmbedding: async () => true }))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: async (json: unknown) => json,
}))

const { updateArticle } = await import('../help-center.article.service')
const { runHelpCenterTranslate, HELP_CENTER_TRANSLATE_QUEUE } =
  await import('../help-center-translate-queue')
const { queueTranslationUpkeep, runTranslationCatchUp } =
  await import('../help-center-translation-upkeep')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.execute(sql`SELECT payload FROM job_queue LIMIT 0`)
    await db
      .select({ r: helpCenterArticleTranslations.pendingSourceRevision })
      .from(helpCenterArticleTranslations)
      .limit(0)
  },
})

function job(payload: Record<string, unknown>): ClaimedJob {
  return {
    id: '0',
    jobId: 'job_test',
    queue: HELP_CENTER_TRANSLATE_QUEUE,
    dedupeKey: null,
    payload,
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 3,
    leaseToken: 'lease',
    lockedUntil: new Date(Date.now() + 60_000),
    runAt: new Date(),
  }
}

let author: PrincipalId

async function seedArticle(opts: { published?: boolean } = {}): Promise<KbArticleId> {
  const categoryId = createId('kb_category')
  await testDb
    .insert(helpCenterCategories)
    .values({ id: categoryId as never, slug: `c-${categoryId}`, name: 'General' })
  const id = createId('kb_article') as KbArticleId
  await testDb.insert(helpCenterArticles).values({
    id,
    categoryId: categoryId as never,
    slug: `a-${id}`,
    title: 'Refunds',
    content: 'How refunds work.',
    principalId: author,
    publishedAt: opts.published === false ? null : new Date(),
  } as never)
  return id
}

async function translate(articleId: KbArticleId, locale: string, sourceRevision = 1) {
  await testDb.insert(helpCenterArticleTranslations).values({
    articleId,
    locale,
    title: 'Erstattungen',
    content: 'Von Hand geschrieben.',
    status: 'published',
    sourceRevision,
  })
}

async function queuedFor(articleId: string) {
  const result = await testDb.execute(sql`
    SELECT payload->>'locale' AS locale, dedupe_key FROM job_queue
    WHERE queue = ${HELP_CENTER_TRANSLATE_QUEUE} AND status = 'pending'
      AND payload->>'articleId' = ${articleId}
    ORDER BY 1
  `)
  return Array.from(result as unknown as Iterable<{ locale: string; dedupe_key: string }>)
}

async function translation(articleId: KbArticleId, locale: string) {
  const [row] = await testDb
    .select()
    .from(helpCenterArticleTranslations)
    .where(
      and(
        eq(helpCenterArticleTranslations.articleId, articleId),
        eq(helpCenterArticleTranslations.locale, locale)
      )
    )
  return row
}

describe.skipIf(!fixture.available)('automatic translation upkeep', () => {
  beforeEach(async () => {
    await fixture.begin()
    state.enabled = true
    state.modelCalls = 0
    author = createId('principal') as PrincipalId
    await testDb.insert(principal).values({ id: author, createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('a text change on a published article queues each language once per revision', async () => {
    const id = await seedArticle()
    await updateArticle(id, { title: 'Refunds and returns' })
    await vi.waitFor(async () => expect(await queuedFor(id)).toHaveLength(2))
    expect(await queuedFor(id)).toEqual([
      { locale: 'de', dedupe_key: `upkeep:${id}:de:2` },
      { locale: 'fr', dedupe_key: `upkeep:${id}:fr:2` },
    ])

    // The same text again is the same revision: nothing new is queued.
    await queueTranslationUpkeep({ id, locale: 'en', textRevision: 2, publishedAt: new Date() })
    expect(await queuedFor(id)).toHaveLength(2)
  })

  it('queues nothing while "Translate automatically" is off', async () => {
    state.enabled = false
    const id = await seedArticle()
    await queueTranslationUpkeep({ id, locale: 'en', textRevision: 2, publishedAt: new Date() })
    expect(await queuedFor(id)).toEqual([])
  })

  it('the job leaves the live text and adds an update waiting for review', async () => {
    const id = await seedArticle()
    await translate(id, 'de')
    await testDb
      .update(helpCenterArticles)
      .set({ textRevision: 2 })
      .where(eq(helpCenterArticles.id, id))
    const before = await translation(id, 'de')

    await runHelpCenterTranslate(job({ type: 'translate-article', articleId: id, locale: 'de' }))

    const after = await translation(id, 'de')
    expect(after).toMatchObject({
      title: before.title,
      content: before.content,
      status: 'published',
      sourceRevision: 1,
      updatedAt: before.updatedAt,
      pendingTitle: 'Erstattungen (KI)',
      pendingContent: 'Wie Erstattungen jetzt funktionieren.',
      pendingSourceRevision: 2,
      checkResult: { ok: true, problems: [] },
    })
    expect(after.pendingSourceText?.title).toBe('Refunds')

    // Run again: the update for this version is already waiting.
    await runHelpCenterTranslate(job({ type: 'translate-article', articleId: id, locale: 'de' }))
    expect(state.modelCalls).toBe(1)
  })

  it('the job makes a draft for a missing language, recording the version it came from', async () => {
    const id = await seedArticle()
    await runHelpCenterTranslate(job({ type: 'translate-article', articleId: id, locale: 'fr' }))
    expect(await translation(id, 'fr')).toMatchObject({
      title: 'Erstattungen (KI)',
      status: 'draft',
      sourceRevision: 1,
      checkResult: { ok: true },
    })
  })

  it('the catch-up queues only published translations behind their article, once a day', async () => {
    const behind = await seedArticle()
    await translate(behind, 'de')
    await translate(behind, 'fr', 2)
    const waiting = await seedArticle()
    await translate(waiting, 'de')
    await testDb
      .update(helpCenterArticleTranslations)
      .set({ pendingTitle: 'x', pendingSourceRevision: 2 })
      .where(eq(helpCenterArticleTranslations.articleId, waiting))
    const draftArticle = await seedArticle({ published: false })
    await translate(draftArticle, 'de')
    const missing = await seedArticle()
    await testDb
      .update(helpCenterArticles)
      .set({ textRevision: 2 })
      .where(inArray(helpCenterArticles.id, [behind, waiting, draftArticle, missing]))

    const now = new Date('2026-11-28T03:40:00Z')
    expect(await runTranslationCatchUp(now)).toBe(1)
    expect(await queuedFor(behind)).toEqual([
      { locale: 'de', dedupe_key: `catch-up:${behind}:de:2:2026-11-28` },
    ])
    expect(await queuedFor(waiting)).toEqual([])
    expect(await queuedFor(draftArticle)).toEqual([])
    expect(await queuedFor(missing)).toEqual([])

    await runTranslationCatchUp(now)
    expect(await queuedFor(behind)).toHaveLength(1)
  })
})
