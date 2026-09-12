import { db, sql, ticketStatuses, ticketTypes } from '@/lib/server/db'
import { slugify } from '@/lib/shared/utils'

type SlugRegistry = typeof ticketStatuses | typeof ticketTypes

/**
 * Ticket-status and ticket-type slugs use underscores (matching the seeded
 * sets). `slugify` emits hyphens; rewrite them here so both registries share
 * one derivation.
 */
export function toUnderscoreSlug(name: string): string {
  return slugify(name).replace(/-/g, '_')
}

/** First unused `base`, then `base_2`, `base_3`, … */
export function nextUniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Derive an underscore slug from `name` that is unique across `table.slug`
 * (including soft-deleted rows — slug is globally unique on both tables).
 */
export async function uniqueUnderscoreSlug(
  name: string,
  fallback: string,
  table: SlugRegistry
): Promise<string> {
  const base = toUnderscoreSlug(name) || fallback
  const existing = await db
    .select({ slug: table.slug })
    .from(table)
    .where(sql`${table.slug} = ${base} OR ${table.slug} LIKE ${base + '_%'}`)
  return nextUniqueSlug(base, new Set(existing.map((row) => row.slug)))
}
