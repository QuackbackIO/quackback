/**
 * The brand media sweep: delete logos, favicons, header logos and portal
 * images nothing points at any more.
 *
 * Removing a logo in Settings, or replacing a design's image, only clears the
 * pointer, so the object stays in storage. This sweep lists those prefixes and
 * deletes an object only when it is older than {@link BRAND_MEDIA_MIN_AGE_MS}
 * (an upload not yet saved anywhere is never touched) AND no row that can
 * hold one names its key:
 *
 *  - the settings row (logo, favicon, header logo, share image, and any
 *    branding JSON it carries);
 *  - the design's draft, every kept revision and every saved design;
 *  - preview links;
 *  - brand match captures.
 *
 * The check reads each table whole as text and looks for the key, so a key
 * held anywhere in a row, in any form (bare key or `/api/storage/` URL),
 * keeps its object. That errs on keeping. The sweep holds its own lock, logs
 * with pino, and supports a dry run that only reports.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'
import { config } from '@/lib/server/config'
import { currentWorkspaceStorage, isS3Usable, type StoredObject } from './s3'

const log = logger.child({ component: 'brand-media-sweep' })

/** The upload prefixes this sweep owns. */
export const BRAND_MEDIA_PREFIXES = [
  'logos/',
  'favicons/',
  'header-logos/',
  'portal-images/',
] as const

/** An object younger than this is never deleted, referenced or not. */
export const BRAND_MEDIA_MIN_AGE_MS = 7 * 24 * 60 * 60_000

/** The tables whose rows can hold a brand media key. */
const REFERENCING_TABLES = [
  'settings',
  'portal_designs',
  'portal_design_revisions',
  'portal_design_preview_links',
  'portal_design_saved',
  'site_captures',
] as const

/** Every row that can reference brand media, as text. */
async function referenceText(): Promise<string> {
  const parts: string[] = []
  for (const table of REFERENCING_TABLES) {
    const rows = getExecuteRows<{ row: string }>(
      await db.execute(sql`select t::text as row from ${sql.identifier(table)} t`)
    )
    for (const r of rows) parts.push(r.row)
  }
  return parts.join('\n')
}

/** The keys among `keys` that no row references. */
export async function unreferencedKeys(keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return []
  const text = await referenceText()
  return keys.filter((key) => {
    const encoded = key.split('/').map(encodeURIComponent).join('/')
    return !text.includes(key) && !text.includes(encoded)
  })
}

export interface BrandMediaStorage {
  listUnder(
    prefix: string,
    continuationToken?: string
  ): Promise<{ objects: StoredObject[]; nextToken?: string }>
  remove(key: string): Promise<void>
}

export interface BrandMediaSweepOptions {
  /** Report without deleting. Defaults to on unless `BRAND_MEDIA_SWEEP_DELETE` is set. */
  dryRun?: boolean
  now?: Date
  /** The storage to sweep; the current workspace's by default. */
  storage?: BrandMediaStorage
}

export interface BrandMediaSweepResult {
  /** Objects deleted, or that would be in a dry run. */
  deleted: string[]
  /** Old objects kept because something references them. */
  referenced: number
  /** Objects too young to consider. */
  young: number
  failed: number
}

/** Delete brand media objects that are old enough and referenced by nothing. */
export async function sweepUnusedBrandMedia(
  opts: BrandMediaSweepOptions = {}
): Promise<BrandMediaSweepResult> {
  const result: BrandMediaSweepResult = { deleted: [], referenced: 0, young: 0, failed: 0 }
  // Deleting stored files is hard to undo, and self-hosted installs upgrade
  // unwatched, so deleting is opt-in.
  const dryRun = opts.dryRun ?? !config.brandMediaSweepDelete
  if (!opts.storage && !isS3Usable()) return result
  const storage = opts.storage ?? (await currentWorkspaceStorage())
  const cutoff = (opts.now ?? new Date()).getTime() - BRAND_MEDIA_MIN_AGE_MS

  const old: string[] = []
  for (const prefix of BRAND_MEDIA_PREFIXES) {
    let token: string | undefined
    do {
      const page = await storage.listUnder(prefix, token)
      for (const object of page.objects) {
        // No timestamp means its age is unknown: keep it.
        if (!object.lastModified || object.lastModified.getTime() > cutoff) result.young++
        else old.push(object.key)
      }
      token = page.nextToken
    } while (token)
  }

  const unused = await unreferencedKeys(old)
  result.referenced = old.length - unused.length
  for (const key of unused) {
    if (dryRun) {
      result.deleted.push(key)
      continue
    }
    try {
      await storage.remove(key)
      result.deleted.push(key)
    } catch (err) {
      result.failed++
      log.warn({ err, key }, 'brand media delete failed; the next run retries it')
    }
  }

  log.info(
    {
      event: 'brand_media_sweep',
      dryRun,
      sample: result.deleted.slice(0, 5),
      deleted: result.deleted.length,
      referenced: result.referenced,
      young: result.young,
      failed: result.failed,
    },
    dryRun ? 'brand media sweep dry run: would delete these' : 'brand media sweep done'
  )
  return result
}
