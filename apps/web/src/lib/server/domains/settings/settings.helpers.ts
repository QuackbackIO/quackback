/**
 * Internal shared helpers for settings sub-modules.
 * NOT part of the public API — import from settings.service instead.
 */
import { db } from '@/lib/server/db'
import { cacheDel, CACHE_KEYS } from '@/lib/server/redis'
import { NotFoundError, InternalError, ValidationError } from '@/lib/shared/errors'

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
