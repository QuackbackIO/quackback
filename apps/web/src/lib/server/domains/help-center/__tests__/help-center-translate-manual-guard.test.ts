/**
 * A translation a person wrote is never replaced by an auto-translation that
 * was parked at the AI allowance.
 *
 * Two layers, both against the real tables and job_queue (rolled back):
 * every manual translation change, and deleting the article, cancels pending
 * auto-translate rows for it; and a parked job that still runs re-checks the
 * translation it was parked against and skips if a person changed it since.
 * An ordinary (never parked) auto-translate keeps its existing behaviour.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type KbArticleId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  principal,
  sql,
  user,
} from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const state = vi.hoisted(() => ({
  exhausted: true,
  windowEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
  modelCalls: 0,
}))

vi.mock('@/lib/server/domains/ai/ai-budget', () => ({
  getAiBudgetStatus: async () => ({
    cap: 1000,
    used: state.exhausted ? 1000 : 0,
    exhausted: state.exhausted,
    window: { kind: 'month', start: new Date(0), end: state.windowEnd },
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
    return { title: 'AUTO title', content: 'AUTO body' }
  },
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getHelpCenterConfig: async () => ({ autoTranslate: { enabled: true, protectedTerms: [] } }),
}))

const { runHelpCenterTranslate, listPausedTranslationLocales, HELP_CENTER_TRANSLATE_QUEUE } =
  await import('../help-center-translate-queue')
const { runHelpCenterTranslateResume } = await import('../help-center-translate-resume')
const { upsertArticleTranslation, setArticleTranslationStatus, deleteArticleTranslation } =
  await import('../help-center-translations.service')
const { deleteArticle } = await import('../help-center.article.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.execute(sql`SELECT payload FROM job_queue LIMIT 0`)
    await db
      .select({ id: helpCenterArticleTranslations.id })
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

async function seedArticle(): Promise<KbArticleId> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: 'Editor', email: `${userId}@example.com` })
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  const categoryId = createId('kb_category')
  await testDb
    .insert(helpCenterCategories)
    .values({ id: categoryId as never, slug: `c-${categoryId}`, name: 'General' })
  const articleId = createId('kb_article') as KbArticleId
  await testDb.insert(helpCenterArticles).values({
    id: articleId,
    categoryId: categoryId as never,
    slug: `a-${articleId}`,
    title: 'Refunds',
    content: 'How refunds work.',
    principalId,
  } as never)
  return articleId
}

async function pendingFor(articleId: string) {
  const result = await testDb.execute(sql`
    SELECT payload FROM job_queue
    WHERE queue = ${HELP_CENTER_TRANSLATE_QUEUE} AND status = 'pending'
      AND payload->>'articleId' = ${articleId}
  `)
  return Array.from(result as unknown as Iterable<{ payload: Record<string, unknown> }>)
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

const manual = (articleId: KbArticleId) => ({
  articleId,
  locale: 'de',
  title: 'Erstattungen',
  content: 'Von Hand geschrieben.',
})

describe.skipIf(!fixture.available)('parked auto-translate never replaces manual work', () => {
  beforeEach(async () => {
    await fixture.begin()
    state.exhausted = true
    state.modelCalls = 0
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function park(articleId: KbArticleId, locale = 'de') {
    await runHelpCenterTranslate(job({ type: 'translate-article', articleId, locale }))
    expect(await listPausedTranslationLocales(articleId)).toContain(locale)
  }

  it('a manual edit cancels the parked job and the edit survives the reset', async () => {
    const articleId = await seedArticle()
    await park(articleId)
    await upsertArticleTranslation(manual(articleId))

    expect(await pendingFor(articleId)).toHaveLength(0)
    state.exhausted = false
    await runHelpCenterTranslateResume(job({}))
    expect(await pendingFor(articleId)).toHaveLength(0)
    expect((await translation(articleId, 'de'))?.content).toBe('Von Hand geschrieben.')
  })

  it('publishing, unpublishing or deleting a translation cancels the parked job', async () => {
    const articleId = await seedArticle()
    await upsertArticleTranslation(manual(articleId))

    await park(articleId)
    await setArticleTranslationStatus(articleId, 'de', 'published')
    expect(await pendingFor(articleId)).toHaveLength(0)

    await park(articleId)
    await setArticleTranslationStatus(articleId, 'de', 'draft')
    expect(await pendingFor(articleId)).toHaveLength(0)

    await park(articleId)
    await deleteArticleTranslation(articleId, 'de')
    expect(await pendingFor(articleId)).toHaveLength(0)
  })

  it('only cancels the locale that changed', async () => {
    const articleId = await seedArticle()
    await park(articleId, 'de')
    await park(articleId, 'fr')
    await upsertArticleTranslation(manual(articleId))
    expect(await listPausedTranslationLocales(articleId)).toEqual(['fr'])
  })

  it('deleting the article cancels every locale', async () => {
    const articleId = await seedArticle()
    await park(articleId, 'de')
    await park(articleId, 'fr')
    await deleteArticle(articleId)
    expect(await pendingFor(articleId)).toHaveLength(0)
  })

  it('a released job skips a translation changed after it was parked', async () => {
    const articleId = await seedArticle()
    await park(articleId)
    // A change that slipped past cancellation (written straight to the table).
    await testDb.insert(helpCenterArticleTranslations).values({
      articleId,
      locale: 'de',
      title: 'Erstattungen',
      content: 'Von Hand geschrieben.',
      status: 'published',
    })

    state.exhausted = false
    await runHelpCenterTranslateResume(job({}))
    const [released] = await pendingFor(articleId)
    expect(released).toBeDefined()
    await runHelpCenterTranslate(job(released!.payload))

    expect(state.modelCalls).toBe(0)
    const row = await translation(articleId, 'de')
    expect(row?.content).toBe('Von Hand geschrieben.')
    expect(row?.status).toBe('published')
  })

  it('a released job still translates when nothing changed', async () => {
    const articleId = await seedArticle()
    await park(articleId)
    state.exhausted = false
    await runHelpCenterTranslateResume(job({}))
    const [released] = await pendingFor(articleId)
    await runHelpCenterTranslate(job(released!.payload))
    expect((await translation(articleId, 'de'))?.content).toBe('AUTO body')
  })

  it('an ordinary auto-translate keeps overwriting as before', async () => {
    state.exhausted = false
    const articleId = await seedArticle()
    await upsertArticleTranslation(manual(articleId))
    await runHelpCenterTranslate(job({ type: 'translate-article', articleId, locale: 'de' }))
    expect((await translation(articleId, 'de'))?.content).toBe('AUTO body')
  })
})
