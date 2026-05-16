/**
 * Internal shared helpers for settings sub-modules.
 * NOT part of the public API — import from settings.service instead.
 */
import { db } from '@/lib/server/db'
import { cacheDel, CACHE_KEYS } from '@/lib/server/redis'
import { NotFoundError, InternalError, ValidationError } from '@/lib/shared/errors'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import {
  DEFAULT_PORTAL_CONFIG,
  PORTAL_WELCOME_CARD_TITLE_MAX,
  type PortalWelcomeCard,
} from './settings.types'

export type SettingsRecord = NonNullable<Awaited<ReturnType<typeof db.query.settings.findFirst>>>

/** @internal */
export function parseJsonConfig<T extends object>(json: string | null, defaultValue: T): T {
  if (!json) return defaultValue
  try {
    return deepMerge(defaultValue, JSON.parse(json))
  } catch {
    return defaultValue
  }
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

/** @internal */
export async function requireSettings(): Promise<SettingsRecord> {
  const org = await db.query.settings.findFirst()
  if (!org) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  return org
}

/** @internal */
export function wrapDbError(operation: string, error: unknown): never {
  if (error instanceof NotFoundError || error instanceof ValidationError) throw error
  const message = error instanceof Error ? error.message : 'Unknown error'
  throw new InternalError('DATABASE_ERROR', `Failed to ${operation}: ${message}`, error)
}

/** @internal */
export async function invalidateSettingsCache(): Promise<void> {
  console.log(`[domain:settings] Invalidating settings cache`)
  await cacheDel(CACHE_KEYS.TENANT_SETTINGS)
}

/**
 * Merge a partial `welcomeCard` update into the stored card. Unlike
 * {@link deepMerge}, the `body` field is replaced wholesale — a TipTap
 * doc with no `content` must clear the previous content, not retain it.
 *
 * @internal
 */
export function mergeWelcomeCard(
  existing: PortalWelcomeCard | undefined,
  input: Partial<PortalWelcomeCard> | undefined
): PortalWelcomeCard {
  const base = existing ?? DEFAULT_PORTAL_CONFIG.welcomeCard!
  if (!input) return existing ?? base
  return { ...base, ...input }
}

/**
 * Project a stored welcome card for public consumption. Disabled cards
 * have draft title/body that must not leak through the public portal
 * config endpoint.
 *
 * @internal
 */
export function publicWelcomeCard(
  card: PortalWelcomeCard | undefined
): PortalWelcomeCard | undefined {
  if (!card?.enabled) return undefined
  return card
}

/**
 * Normalize a partial `welcomeCard` update before it's merged into stored
 * portalConfig. Trims the title, enforces the length cap, and runs the
 * TipTap body through the standard sanitizer.
 *
 * @internal
 */
export function normalizeWelcomeCardInput(
  input: Partial<PortalWelcomeCard> | undefined
): Partial<PortalWelcomeCard> | undefined {
  if (!input) return input
  const normalized: Partial<PortalWelcomeCard> = { ...input }
  if (typeof input.title === 'string') {
    const trimmed = input.title.trim()
    if (trimmed.length > PORTAL_WELCOME_CARD_TITLE_MAX) {
      throw new ValidationError(
        'WELCOME_CARD_TITLE_TOO_LONG',
        `Welcome card title must be ${PORTAL_WELCOME_CARD_TITLE_MAX} characters or fewer`
      )
    }
    normalized.title = trimmed
  }
  if (input.body !== undefined) {
    normalized.body = sanitizeTiptapContent(input.body)
  }
  return normalized
}
