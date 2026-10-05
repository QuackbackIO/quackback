/**
 * Help center auto-translate stops at the AI allowance and picks up again
 * when allowance is available.
 *
 * A job that finds the allowance used up parks a pending row in the real
 * job_queue (rolled back) until the end of the allowance window; the resume
 * sweep releases parked rows early once allowance is back (an upgrade, a top
 * up), and leaves them parked while it is not.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { sql } from '@/lib/server/db'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const state = vi.hoisted(() => ({
  exhausted: true,
  windowEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
  translated: [] as Array<{ articleId: string; locale: string }>,
  /** Runs right after the resume sweep inserts replacement jobs. */
  afterReplacementInsert: null as null | (() => Promise<void>),
}))

// A seam at the moment the replacement rows exist: a competing worker can
// claim one from here on, so whatever it sees must already be consistent.
vi.mock('@/lib/server/jobs/job-queue', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/jobs/job-queue')>()
  return {
    ...real,
    enqueueJobs: async (...args: Parameters<typeof real.enqueueJobs>) => {
      const out = await real.enqueueJobs(...args)
      if (state.afterReplacementInsert) await state.afterReplacementInsert()
      return out
    },
  }
})

vi.mock('@/lib/server/domains/ai/ai-budget', () => ({
  getAiBudgetStatus: async () => ({
    cap: 1000,
    used: state.exhausted ? 1000 : 0,
    exhausted: state.exhausted,
    window: { kind: 'month', start: new Date(0), end: state.windowEnd },
  }),
}))

vi.mock('../help-center-auto-translate.service', () => ({
  translateArticleForLocale: async (articleId: string, locale: string) => {
    if (state.exhausted) return { pausedUntil: state.windowEnd }
    state.translated.push({ articleId, locale })
    return undefined
  },
}))

const { runHelpCenterTranslate, listPausedTranslationLocales, HELP_CENTER_TRANSLATE_QUEUE } =
  await import('../help-center-translate-queue')
const { runHelpCenterTranslateResume, hasPausedTranslations } =
  await import('../help-center-translate-resume')

const fixture = await createDbTestFixture({
  probe: async (db) => void (await db.execute(sql`SELECT payload FROM job_queue LIMIT 0`)),
})

const articleId = () => createId('kb_article')

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

async function rowsFor(id: string) {
  const result = await testDb.execute(sql`
    SELECT payload, run_at, status FROM job_queue
    WHERE queue = ${HELP_CENTER_TRANSLATE_QUEUE} AND payload->>'articleId' = ${id}
    ORDER BY id
  `)
  return Array.from(
    result as unknown as Iterable<{
      payload: Record<string, unknown>
      run_at: Date | string
      status: string
    }>
  )
}

describe.skipIf(!fixture.available)('help center auto-translate at the AI allowance', () => {
  beforeEach(async () => {
    await fixture.begin()
    state.exhausted = true
    state.translated = []
    state.afterReplacementInsert = null
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('parks the item until the window ends instead of translating', async () => {
    const id = articleId()
    await runHelpCenterTranslate(job({ type: 'translate-article', articleId: id, locale: 'de' }))

    const rows = await rowsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('pending')
    expect(rows[0]!.payload).toMatchObject({ articleId: id, locale: 'de', paused: true })
    expect(new Date(rows[0]!.run_at).getTime()).toBe(state.windowEnd.getTime())
    expect(await listPausedTranslationLocales(id)).toEqual(['de'])
    expect(await hasPausedTranslations()).toBe(true)
  })

  it('parks one row per item however many jobs hit the cap', async () => {
    const id = articleId()
    const payload = { type: 'translate-article', articleId: id, locale: 'fr' }
    await runHelpCenterTranslate(job(payload))
    await runHelpCenterTranslate(job(payload))
    expect(await rowsFor(id)).toHaveLength(1)
  })

  it('leaves parked items alone while the allowance is still used up', async () => {
    const id = articleId()
    await runHelpCenterTranslate(job({ type: 'translate-article', articleId: id, locale: 'de' }))
    await runHelpCenterTranslateResume(job({}))
    expect(await listPausedTranslationLocales(id)).toEqual(['de'])
  })

  it('releases parked items as soon as allowance is available', async () => {
    const id = articleId()
    await runHelpCenterTranslate(job({ type: 'translate-article', articleId: id, locale: 'de' }))
    state.exhausted = false
    await runHelpCenterTranslateResume(job({}))

    expect(await listPausedTranslationLocales(id)).toEqual([])
    const rows = await rowsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toMatchObject({ articleId: id, locale: 'de' })
    expect(rows[0]!.payload.paused).toBeUndefined()
    expect(new Date(rows[0]!.run_at).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('translates straight through when allowance remains', async () => {
    state.exhausted = false
    const id = articleId()
    await runHelpCenterTranslate(job({ type: 'translate-article', articleId: id, locale: 'de' }))
    expect(state.translated).toEqual([{ articleId: id, locale: 'de' }])
    expect(await rowsFor(id)).toHaveLength(0)
  })

  it('a replacement claimed at once can park again: the release is atomic', async () => {
    const id = articleId()
    const payload = { type: 'translate-article', articleId: id, locale: 'de' }
    await runHelpCenterTranslate(job(payload))

    // Allowance comes back, the sweep releases the item, and before it
    // returns a worker claims the replacement just as the allowance runs out
    // again. That worker must be able to park the item; if the old parked
    // row still held the dedupe key the item would be dropped.
    state.exhausted = false
    state.afterReplacementInsert = async () => {
      state.afterReplacementInsert = null
      state.exhausted = true
      await runHelpCenterTranslate(job(payload))
    }
    await runHelpCenterTranslateResume(job({}))

    expect(await listPausedTranslationLocales(id)).toEqual(['de'])
  })
})
