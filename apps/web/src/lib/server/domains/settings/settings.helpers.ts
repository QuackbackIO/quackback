/**
 * Internal shared helpers for settings sub-modules.
 * NOT part of the public API — import from settings.service instead.
 */
import { db, eq, settings } from '@/lib/server/db'
import { cacheDel, CACHE_KEYS } from '@/lib/server/cache'
import { DomainException, InternalError, NotFoundError } from '@/lib/shared/errors'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { logger } from '@/lib/server/logger'
import {
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  EMPTY_WELCOME_BODY,
  LEGACY_PORTAL_CONFIG,
  LEGACY_WIDGET_CONFIG,
  type PortalConfig,
  type PortalWelcomeCard,
  type WidgetConfig,
} from './settings.types'
import type { TiptapContent } from '@/lib/shared/db-types'

const log = logger.child({ component: 'settings-helpers' })

export type SettingsRecord = NonNullable<Awaited<ReturnType<typeof db.query.settings.findFirst>>>

function storedJsonIsBlank(json: string | null): boolean {
  if (!json) return true
  const trimmed = json.trim()
  return trimmed === '' || trimmed === 'null'
}

/** @internal */
export function parseJsonConfig<T extends object>(json: string | null, defaultValue: T): T {
  if (!json) return defaultValue
  try {
    return deepMerge(defaultValue, JSON.parse(json))
  } catch {
    return defaultValue
  }
}

/**
 * Merge stored JSON over `legacyDefault` so missing nested keys keep their
 * historical off values. Null/empty blobs use `currentDefault` (new installs).
 */
export function parseStoredConfig<T extends object>(
  json: string | null,
  currentDefault: T,
  legacyDefault: T
): T {
  if (storedJsonIsBlank(json)) return currentDefault
  try {
    return deepMerge(legacyDefault, JSON.parse(json as string))
  } catch {
    return currentDefault
  }
}

/** @internal */
export function parseWidgetConfig(json: string | null): WidgetConfig {
  return parseStoredConfig(json, DEFAULT_WIDGET_CONFIG, LEGACY_WIDGET_CONFIG)
}

/** @internal */
export function parseJsonOrNull<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/** @internal */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key in source) {
    if (source[key] !== undefined) {
      const srcVal = source[key]
      const tgtVal = result[key]
      const isNestedObject =
        typeof srcVal === 'object' &&
        srcVal !== null &&
        !Array.isArray(srcVal) &&
        typeof tgtVal === 'object' &&
        tgtVal !== null

      result[key] = isNestedObject
        ? (deepMerge(
            tgtVal as Record<string, unknown>,
            srcVal as Record<string, unknown>
          ) as T[typeof key])
        : (srcVal as T[typeof key])
    }
  }
  return result
}

/*
 * The settings row is read through one of two tiers.
 *
 * - requireSettings(): the row, read fresh from the database. Every
 *   read-modify-write starts here (writeMetadataKey does), so a write is never
 *   based on a copy.
 * - requireSettingsCached() / findSettingsCached(): the row inside the workspace
 *   settings (getWorkspaceSettings), for every read-only path. A request reads
 *   it at most once whichever of the two it asks through, this process reuses
 *   it for a few seconds (local-cache.ts) and the kv cache for longer.
 *   invalidateSettingsCache(), which every settings write calls, forgets all
 *   three, so the writing request and the next one see the write; another
 *   process sees it once its local copy expires. Date columns arrive as ISO
 *   strings after the kv round trip.
 *
 * A getter whose value can feed a write takes a SettingsFreshness argument:
 * 'fresh' when the caller derives what it writes (or deletes) from the value.
 */

/** @internal */
export async function requireSettings(): Promise<SettingsRecord> {
  const org = await db.query.settings.findFirst()
  if (!org) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  return org
}

/** Which tier a getter reads: 'fresh' when its value feeds a write. */
export type SettingsFreshness = 'cached' | 'fresh'

/** @internal */
export function readSettingsRow(freshness: SettingsFreshness = 'cached'): Promise<SettingsRecord> {
  return freshness === 'fresh' ? requireSettings() : requireSettingsCached()
}

/** @internal */
export async function requireSettingsCached(): Promise<SettingsRecord> {
  const org = await findSettingsCached()
  if (!org) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  return org
}

/**
 * {@link requireSettingsCached} for callers that treat a missing row as a
 * state rather than an error: null before the workspace has one.
 *
 * @internal
 */
export async function findSettingsCached(): Promise<SettingsRecord | null> {
  // Dynamic import: settings.service imports these helpers at module scope,
  // so a static import here would be a load-time cycle.
  const { getWorkspaceSettingsRow } = await import('./settings.service')
  return getWorkspaceSettingsRow()
}

/** @internal */
export function wrapDbError(operation: string, error: unknown): never {
  // Named refusals (402/403/404/…) must stay themselves. Wrapping a
  // TierLimitError here turned branding custom-colour saves into 500s.
  if (error instanceof DomainException) throw error
  const message = error instanceof Error ? error.message : 'Unknown error'
  throw new InternalError('DATABASE_ERROR', `Failed to ${operation}: ${message}`, error)
}

/** @internal */
export async function invalidateSettingsCache(): Promise<void> {
  log.info('invalidating settings cache')
  // REGISTERED_AUTH_PROVIDERS is derived from authConfig.oauth (part of workspace
  // settings) and the identity_provider list; every identity-provider write
  // funnels through here, so drop it alongside the settings row.
  await cacheDel(CACHE_KEYS.WORKSPACE_SETTINGS, CACHE_KEYS.REGISTERED_AUTH_PROVIDERS)
}

/**
 * Read-modify-write one key in the `settings.metadata` JSON bag, preserving
 * sibling keys, then bust the settings cache. Non-atomic (last write wins) —
 * acceptable for the admin-driven settings families (office hours, tickets) that
 * ride in this generic bag rather than a dedicated column.
 *
 * `value` may be a function of the freshly read bag, for a partial update
 * that merges over what is stored: the merge then starts from the fresh row,
 * never from a cached read. Returns the value written.
 *
 * @internal
 */
export async function writeMetadataKey<T>(
  key: string,
  value: T | ((storedMetadata: string | null) => T)
): Promise<T> {
  const org = await requireSettings()
  const next =
    typeof value === 'function'
      ? (value as (storedMetadata: string | null) => T)(org.metadata)
      : value
  const meta = parseJsonOrNull<Record<string, unknown>>(org.metadata) ?? {}
  meta[key] = next
  await db
    .update(settings)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(settings.id, org.id))
  await invalidateSettingsCache()
  return next
}

/**
 * Stored welcome card, including the legacy `{ enabled, title, body }`
 * shape repaired by {@link resolveWelcomeCard} on read.
 *
 * @internal
 */
export type StoredWelcomeCard = {
  enabled?: boolean
  title?: string
  body?: TiptapContent
}

/**
 * Read-time repair of a stored welcome card to `{ body }`.
 *
 * - `enabled: true` and a non-empty title → prepend a level-2 heading
 *   node to `body.content`, then drop `title` and `enabled`.
 * - `enabled: false` → empty body (intentionally discards disabled drafts).
 * - `enabled` absent (the post-simplification `{ body }` write) → body as stored.
 *
 * @internal
 */
export function resolveWelcomeCard(
  card: StoredWelcomeCard | PortalWelcomeCard | undefined
): PortalWelcomeCard {
  if (!card) return { body: EMPTY_WELCOME_BODY }

  const stored = card as StoredWelcomeCard
  if (stored.enabled === false) return { body: EMPTY_WELCOME_BODY }

  const body = stored.body ?? EMPTY_WELCOME_BODY
  if (stored.enabled !== true) return { body }

  const title = stored.title?.trim() ?? ''
  if (!title) return { body }

  const heading: TiptapContent = {
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: title }],
  }
  return {
    body: {
      type: 'doc',
      content: [heading, ...(body.content ?? [])],
    },
  }
}

/**
 * Parse stored portalConfig and repair the welcome card to `{ body }`.
 *
 * @internal
 */
export function parsePortalConfig(json: string | null): PortalConfig {
  const parsed = parseStoredConfig(json, DEFAULT_PORTAL_CONFIG, LEGACY_PORTAL_CONFIG)
  return { ...parsed, welcomeCard: resolveWelcomeCard(parsed.welcomeCard) }
}

/**
 * Merge a partial `welcomeCard` update into the stored card. Unlike
 * {@link deepMerge}, the `body` field is replaced wholesale — a TipTap
 * doc with no `content` must clear the previous content, not retain it.
 * The result is always the resolved `{ body }` shape (legacy enabled/title
 * are dropped on write).
 *
 * @internal
 */
export function mergeWelcomeCard(
  existing: PortalWelcomeCard | undefined,
  input: Partial<PortalWelcomeCard> | undefined
): PortalWelcomeCard {
  const base = existing ?? DEFAULT_PORTAL_CONFIG.welcomeCard!
  if (!input) return existing ?? base
  return { body: input.body ?? base.body }
}

/**
 * Project a stored welcome card for public consumption. Empty bodies
 * (including legacy disabled cards after {@link resolveWelcomeCard})
 * are omitted so the portal renderer has nothing to show.
 *
 * @internal
 */
export function publicWelcomeCard(
  card: StoredWelcomeCard | PortalWelcomeCard | undefined
): PortalWelcomeCard | undefined {
  const resolved = resolveWelcomeCard(card)
  if (isEmptyTiptapDoc(resolved.body)) return undefined
  return resolved
}

/**
 * Normalize a partial `welcomeCard` update before it's merged into stored
 * portalConfig. Runs the TipTap body through the standard sanitizer.
 *
 * @internal
 */
export function normalizeWelcomeCardInput(
  input: Partial<PortalWelcomeCard> | undefined
): Partial<PortalWelcomeCard> | undefined {
  if (!input) return input
  const normalized: Partial<PortalWelcomeCard> = { ...input }
  if (input.body !== undefined) {
    normalized.body = sanitizeTiptapContent(input.body)
  }
  return normalized
}
