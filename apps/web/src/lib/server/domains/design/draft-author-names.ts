import { db, eq, inArray, principal, user } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import type { DraftAuthors } from './draft-authors'

/**
 * Each change's author as a person reads it: their name, or Quackback AI.
 * Someone who has since left reads as "A former teammate".
 */
export async function authorNames(authors: DraftAuthors): Promise<Record<string, string>> {
  const ids = [...new Set(Object.values(authors).map((key) => key.replace(/^ai:/, '')))]
  if (ids.length === 0) return {}
  const rows = await db
    .select({ id: principal.id, displayName: principal.displayName, name: user.name })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(inArray(principal.id, ids as PrincipalId[]))
  const names = new Map(rows.map((row) => [row.id as string, row.displayName ?? row.name]))
  return Object.fromEntries(
    Object.entries(authors).map(([path, key]) => [
      path,
      key.startsWith('ai:') ? 'Quackback AI' : (names.get(key) ?? 'A former teammate'),
    ])
  )
}
