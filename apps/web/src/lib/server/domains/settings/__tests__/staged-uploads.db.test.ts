/**
 * Real-Postgres proof of the staged upload record and its sweep.
 *
 * An editor upload (a wide logo, later a font) is stored before anything
 * refers to it, and it is saved only when the portal look is published. The
 * upload is recorded in `settings.metadata.stagedUploads`; a daily sweep
 * deletes the ones nothing refers to a day later, and never an object the
 * settings row names.
 *
 * The global `db` is the guarded test handle, so any use of it inside a
 * transaction throws, and the fake delete records whether it ran inside one:
 * a storage call must never hold the settings row lock.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, settings, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { isInsideDbTransaction } from '@/lib/server/workspaces/after-commit'

const seams = vi.hoisted(() => ({
  deleted: [] as string[],
  failDelete: new Set<string>(),
  missing: new Set<string>(),
  /** Keys whose delete never answers, whatever the signal says. */
  hang: new Set<string>(),
  /** Whether each delete call ran inside a database transaction. */
  calledInsideTransaction: [] as boolean[],
  /** The signal each delete was handed. */
  signals: [] as Array<AbortSignal | undefined>,
  /** Runs inside the fake delete, before it answers. */
  duringDelete: null as null | ((key: string) => Promise<void>),
}))

vi.mock('@/lib/server/db', async (original) => {
  const actual = await original<typeof import('@/lib/server/db')>()
  const { guardedTestDb } = await import('@/lib/server/__tests__/db-test-fixture')
  return { ...actual, db: guardedTestDb }
})
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/storage/s3', async (original) => ({
  ...(await original<typeof import('@/lib/server/storage/s3')>()),
  deleteObject: async (key: string, options?: { signal?: AbortSignal }) => {
    seams.calledInsideTransaction.push(isInsideDbTransaction())
    seams.signals.push(options?.signal)
    await seams.duringDelete?.(key)
    if (seams.hang.has(key)) return new Promise<void>(() => {})
    if (seams.failDelete.has(key)) throw new Error('storage unavailable')
    if (seams.missing.has(key))
      throw Object.assign(new Error('gone'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      })
    seams.deleted.push(key)
  },
}))

const {
  isStaged,
  isStagedBrandAsset,
  recordStagedUpload,
  sweepStagedUploads,
  isStagedUploadSweepDue,
  STAGED_UPLOAD_GRACE_MS,
  MAX_STAGED_UPLOADS,
  MAX_SWEEP_DELETES,
} = await import('../settings.staged-uploads')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    const current = getExecuteRows<{ name: string }>(
      await db.execute(sql`select current_database() as name`)
    )[0]
    if (!current?.name.startsWith('quackback_test'))
      throw new Error('Staged upload tests require a quackback_test database')
    await db.select({ metadata: settings.metadata }).from(settings).limit(0)
  },
})
if (!fixture.available)
  throw new Error('Migrate a quackback_test database before running staged upload tests')

let settingsId: WorkspaceId
const NOW = new Date('2026-11-18T12:00:00Z')
const old = new Date(NOW.getTime() - STAGED_UPLOAD_GRACE_MS - 60_000).toISOString()
const fresh = new Date(NOW.getTime() - 60_000).toISOString()

const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]
const setRow = (values: Partial<typeof settings.$inferInsert>) =>
  testDb.update(settings).set(values).where(eq(settings.id, settingsId))
const bag = async () => JSON.parse((await read()).metadata ?? '{}') as Record<string, unknown>
const staged = async () => ((await bag()).stagedUploads ?? []) as Array<{ key: string; at: string }>
const stage = (entries: Array<{ key: string; at: string }>, extra: Record<string, unknown> = {}) =>
  setRow({ metadata: JSON.stringify({ ...extra, stagedUploads: entries }) })

beforeEach(async () => {
  await fixture.begin()
  const [existing] = await testDb.select().from(settings).limit(1)
  const row =
    existing ??
    (
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
        .returning()
    )[0]
  settingsId = row.id
  await setRow({
    metadata: JSON.stringify({ other: { kept: true } }),
    headerLogoKey: null,
    logoKey: null,
    faviconKey: null,
    brandingConfig: null,
  })
  seams.deleted.length = 0
  seams.failDelete.clear()
  seams.missing.clear()
  seams.hang.clear()
  seams.calledInsideTransaction.length = 0
  seams.signals.length = 0
  seams.duringDelete = null
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

describe('recordStagedUpload', () => {
  it('records the key with the time, keeping every other metadata key', async () => {
    await recordStagedUpload('header-logos/2026/11/a-wordmark.svg', { now: NOW })
    await recordStagedUpload('header-logos/2026/11/b-wordmark.png', { now: NOW })
    expect(await bag()).toEqual({
      other: { kept: true },
      stagedUploads: [
        { key: 'header-logos/2026/11/a-wordmark.svg', at: NOW.toISOString() },
        { key: 'header-logos/2026/11/b-wordmark.png', at: NOW.toISOString() },
      ],
    })
  })

  it('refuses a key outside the prefixes the sweep may delete', async () => {
    await expect(recordStagedUpload('avatars/x.png', { now: NOW })).rejects.toThrow()
    expect(await staged()).toEqual([])
  })

  it('refuses another upload once too many are waiting, with a typed error', async () => {
    await stage(
      Array.from({ length: MAX_STAGED_UPLOADS }, (_, i) => ({
        key: `header-logos/${i}.png`,
        at: fresh,
      }))
    )
    await expect(
      recordStagedUpload('header-logos/one-more.png', { now: NOW })
    ).rejects.toMatchObject({
      code: 'TOO_MANY_STAGED_UPLOADS',
    })
    expect(await staged()).toHaveLength(MAX_STAGED_UPLOADS)
  })
})

describe('sweepStagedUploads', () => {
  it('deletes an upload nothing refers to a day later, and forgets it', async () => {
    await stage([{ key: 'header-logos/abandoned.svg', at: old }], { other: { kept: true } })
    const result = await sweepStagedUploads({ now: NOW })
    expect(seams.deleted).toEqual(['header-logos/abandoned.svg'])
    expect(result).toMatchObject({ removed: 1, kept: 0, failed: 0 })
    expect(await bag()).toEqual({ other: { kept: true }, stagedUploads: [] })
  })

  it('leaves an upload younger than a day alone', async () => {
    await stage([{ key: 'header-logos/drafting.svg', at: fresh }])
    await sweepStagedUploads({ now: NOW })
    expect(seams.deleted).toEqual([])
    expect(await staged()).toEqual([{ key: 'header-logos/drafting.svg', at: fresh }])
  })

  it('never deletes an object the settings row names, wherever it names it', async () => {
    await setRow({
      headerLogoKey: 'header-logos/published.svg',
      brandingConfig: JSON.stringify({ customFont: { files: [{ key: 'fonts/brand.woff2' }] } }),
    })
    await stage(
      [
        { key: 'header-logos/published.svg', at: old },
        { key: 'fonts/brand.woff2', at: old },
        { key: 'header-logos/in-another-key.svg', at: old },
      ],
      { note: 'header-logos/in-another-key.svg' }
    )
    const result = await sweepStagedUploads({ now: NOW })
    expect(seams.deleted).toEqual([])
    expect(result).toMatchObject({ removed: 0, kept: 3 })
    // Published objects are the publish's to replace; the record is done.
    expect(await staged()).toEqual([])
    expect((await read()).headerLogoKey).toBe('header-logos/published.svg')
  })

  // Import stages a site's square logo under logos/: only a staged one that
  // nothing names is ever deleted, never the published square logo.
  it('deletes a staged square logo nothing names, and keeps the published one', async () => {
    await setRow({ logoKey: 'logos/published.png' })
    await stage([
      { key: 'logos/2026/11/a-staged-import.png', at: old },
      { key: 'logos/published.png', at: old },
    ])
    await sweepStagedUploads({ now: NOW })
    expect(seams.deleted).toEqual(['logos/2026/11/a-staged-import.png'])
    expect((await read()).logoKey).toBe('logos/published.png')
  })

  it('deletes a staged favicon nothing names, and keeps the published one', async () => {
    await setRow({ faviconKey: 'favicons/published.png' })
    await stage([
      { key: 'favicons/2026/11/a-staged.png', at: old },
      { key: 'favicons/published.png', at: old },
    ])
    await sweepStagedUploads({ now: NOW })
    expect(seams.deleted).toEqual(['favicons/2026/11/a-staged.png'])
  })

  it('never deletes outside the staged prefixes, even if one was recorded', async () => {
    await stage([
      { key: 'avatars/someone.png', at: old },
      { key: 'header-logos/../avatars/someone.png', at: old },
    ])
    await sweepStagedUploads({ now: NOW })
    expect(seams.deleted).toEqual([])
    expect(await staged()).toEqual([])
  })

  it('keeps the record of an upload whose delete failed, marked, and retries it next run', async () => {
    seams.failDelete.add('header-logos/stuck.svg')
    await stage([
      { key: 'header-logos/stuck.svg', at: old },
      { key: 'header-logos/gone.svg', at: old },
    ])
    const result = await sweepStagedUploads({ now: NOW })
    expect(seams.deleted).toEqual(['header-logos/gone.svg'])
    expect(result).toMatchObject({ removed: 1, failed: 1 })
    expect(await staged()).toEqual([{ key: 'header-logos/stuck.svg', at: old, sweeping: true }])
    // A publish can no longer save it: the object may be half gone.
    expect(isStaged((await read()).metadata, 'header-logos/stuck.svg')).toBe(false)

    seams.failDelete.clear()
    const retry = await sweepStagedUploads({ now: NOW })
    expect(retry).toMatchObject({ removed: 1, failed: 0 })
    expect(seams.deleted).toEqual(['header-logos/gone.svg', 'header-logos/stuck.svg'])
    expect(await staged()).toEqual([])
  })

  it('never calls storage while the settings row is locked', async () => {
    seams.failDelete.add('header-logos/stuck.svg')
    await stage([
      { key: 'header-logos/abandoned.svg', at: old },
      { key: 'header-logos/stuck.svg', at: old },
    ])
    await sweepStagedUploads({ now: NOW })
    expect(seams.calledInsideTransaction).toEqual([false, false])
  })

  it('gives up on a delete that hangs, keeps it marked, and goes on to the next', async () => {
    seams.hang.add('header-logos/hung.svg')
    await stage([
      { key: 'header-logos/hung.svg', at: old },
      { key: 'header-logos/after.svg', at: old },
    ])
    const result = await sweepStagedUploads({ now: NOW, deleteTimeoutMs: 50 })
    expect(result).toMatchObject({ removed: 1, failed: 1 })
    expect(seams.deleted).toEqual(['header-logos/after.svg'])
    // The request itself was told to stop, not just abandoned.
    expect(seams.signals[0]?.aborted).toBe(true)
    expect(await staged()).toEqual([{ key: 'header-logos/hung.svg', at: old, sweeping: true }])
  })

  it('claims an upload before deleting it, so a publish meanwhile is refused and a crash loses nothing', async () => {
    await stage([{ key: 'header-logos/abandoned.svg', at: old, brandAsset: true } as never])
    const seen: Array<{ listed: unknown; staged: boolean; brandAsset: boolean }> = []
    seams.duringDelete = async (key) => {
      const metadata = (await read()).metadata
      seen.push({
        listed: (await staged()).find((entry) => entry.key === key),
        staged: isStaged(metadata, key),
        brandAsset: isStagedBrandAsset(metadata, key),
      })
    }
    await sweepStagedUploads({ now: NOW })
    expect(seen).toEqual([
      {
        // Still on the list, so a run that dies here leaves it for the next.
        listed: { key: 'header-logos/abandoned.svg', at: old, brandAsset: true, sweeping: true },
        // But no publish can save it while it is being deleted.
        staged: false,
        brandAsset: false,
      },
    ])
    expect(await staged()).toEqual([])
  })

  it('finishes the delete of an upload a run that died had claimed', async () => {
    await stage([{ key: 'header-logos/claimed.svg', at: old, sweeping: true } as never])
    const result = await sweepStagedUploads({ now: NOW })
    expect(result).toMatchObject({ removed: 1, failed: 0 })
    expect(seams.deleted).toEqual(['header-logos/claimed.svg'])
    expect(await staged()).toEqual([])
  })

  it('still never deletes a claimed upload the row has come to name', async () => {
    await setRow({ headerLogoKey: 'header-logos/claimed.svg' })
    await stage([{ key: 'header-logos/claimed.svg', at: old, sweeping: true } as never], {})
    const result = await sweepStagedUploads({ now: NOW })
    expect(seams.deleted).toEqual([])
    expect(result).toMatchObject({ removed: 0, kept: 1 })
  })

  it('forgets an upload whose object was never stored', async () => {
    // The key is staged before the upload; a refused or abandoned upload
    // leaves no object, which some stores report as not found.
    seams.missing.add('header-logos/never-put.svg')
    await stage([{ key: 'header-logos/never-put.svg', at: old }])
    const result = await sweepStagedUploads({ now: NOW })
    expect(result).toMatchObject({ removed: 1, failed: 0 })
    expect(await staged()).toEqual([])
  })

  it('deletes a bounded number per run and leaves the rest listed for the next', async () => {
    await stage(
      Array.from({ length: MAX_SWEEP_DELETES + 5 }, (_, i) => ({
        key: `header-logos/abandoned-${i}.svg`,
        at: old,
      }))
    )
    const first = await sweepStagedUploads({ now: NOW })
    expect(first.removed).toBe(MAX_SWEEP_DELETES)
    expect(await staged()).toHaveLength(5)
    const second = await sweepStagedUploads({ now: NOW })
    expect(second.removed).toBe(5)
    expect(await staged()).toEqual([])
    expect(new Set(seams.deleted).size).toBe(MAX_SWEEP_DELETES + 5)
  })

  it('does nothing to a metadata bag it cannot read', async () => {
    await setRow({ metadata: '[not an object' })
    await expect(sweepStagedUploads({ now: NOW })).rejects.toThrow()
    expect((await read()).metadata).toBe('[not an object')
    expect(seams.deleted).toEqual([])
  })
})

describe('isStagedUploadSweepDue', () => {
  it('is shut while nothing waiting is a day old', async () => {
    expect(await isStagedUploadSweepDue({ now: NOW })).toBe(false)
    await stage([{ key: 'header-logos/drafting.svg', at: fresh }])
    expect(await isStagedUploadSweepDue({ now: NOW })).toBe(false)
  })

  it('opens once an upload has waited a day', async () => {
    await stage([{ key: 'header-logos/abandoned.svg', at: old }])
    expect(await isStagedUploadSweepDue({ now: NOW })).toBe(true)
  })
})
