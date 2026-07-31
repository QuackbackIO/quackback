/**
 * User tags — lightweight admin-applied labels for portal people.
 *
 * Mirrors the post-tags shape (unique name, color, soft delete) but with no
 * membership rules: assignment is always explicit. Backs the profile tag
 * control and the People-list tag filter (`user.service.listPortalUsers`
 * `tagIds` param). Tags are get-or-created by name so the profile control can
 * mint a label inline without a separate management surface.
 */

import {
  db,
  eq,
  and,
  inArray,
  isNull,
  asc,
  sql,
  userTags,
  userTagAssignments,
} from '@/lib/server/db'
import { createId, type PrincipalId, type UserTagId } from '@quackback/ids'

export interface UserTagSummary {
  id: UserTagId
  name: string
  color: string
}

/** Every live tag, alphabetical — the profile picker and list filter source. */
export async function listUserTags(): Promise<UserTagSummary[]> {
  const rows = await db
    .select({ id: userTags.id, name: userTags.name, color: userTags.color })
    .from(userTags)
    .where(isNull(userTags.deletedAt))
    .orderBy(asc(userTags.name))
  return rows as UserTagSummary[]
}

/** Tags currently on one person, alphabetical. */
export async function listTagsForPrincipal(principalId: PrincipalId): Promise<UserTagSummary[]> {
  const rows = await db
    .select({ id: userTags.id, name: userTags.name, color: userTags.color })
    .from(userTagAssignments)
    .innerJoin(userTags, eq(userTags.id, userTagAssignments.tagId))
    .where(and(eq(userTagAssignments.principalId, principalId), isNull(userTags.deletedAt)))
    .orderBy(asc(userTags.name))
  return rows as UserTagSummary[]
}

/** Find a live tag by exact (case-insensitive) name, or create it. */
export async function getOrCreateUserTag(rawName: string): Promise<UserTagSummary> {
  const name = rawName.trim()
  const existing = await db
    .select({ id: userTags.id, name: userTags.name, color: userTags.color })
    .from(userTags)
    .where(and(sql`LOWER(${userTags.name}) = ${name.toLowerCase()}`, isNull(userTags.deletedAt)))
    .limit(1)
  if (existing[0]) return existing[0] as UserTagSummary

  const id = createId('user_tag') as UserTagId
  // Unique-name race: a concurrent create wins the insert; re-read it.
  await db.insert(userTags).values({ id, name }).onConflictDoNothing()
  const [row] = await db
    .select({ id: userTags.id, name: userTags.name, color: userTags.color })
    .from(userTags)
    .where(sql`LOWER(${userTags.name}) = ${name.toLowerCase()}`)
    .limit(1)
  return row as UserTagSummary
}

/**
 * Assign a tag to a person. Idempotent — the (principal_id, tag_id) unique
 * index makes a repeat assign a no-op.
 */
export async function assignUserTag(principalId: PrincipalId, tagId: UserTagId): Promise<void> {
  await db
    .insert(userTagAssignments)
    .values({ principalId, tagId })
    .onConflictDoNothing({ target: [userTagAssignments.principalId, userTagAssignments.tagId] })
}

export async function removeUserTag(principalId: PrincipalId, tagId: UserTagId): Promise<void> {
  await db
    .delete(userTagAssignments)
    .where(
      and(eq(userTagAssignments.principalId, principalId), eq(userTagAssignments.tagId, tagId))
    )
}

/** Batch tag lookup for a page of list rows: principalId → its tags. */
export async function listTagsForPrincipals(
  principalIds: PrincipalId[]
): Promise<Map<string, UserTagSummary[]>> {
  const map = new Map<string, UserTagSummary[]>()
  if (principalIds.length === 0) return map
  const rows = await db
    .select({
      principalId: userTagAssignments.principalId,
      id: userTags.id,
      name: userTags.name,
      color: userTags.color,
    })
    .from(userTagAssignments)
    .innerJoin(userTags, eq(userTags.id, userTagAssignments.tagId))
    .where(and(inArray(userTagAssignments.principalId, principalIds), isNull(userTags.deletedAt)))
    .orderBy(asc(userTags.name))
  for (const row of rows) {
    if (!map.has(row.principalId)) map.set(row.principalId, [])
    map.get(row.principalId)!.push({ id: row.id as UserTagId, name: row.name, color: row.color })
  }
  return map
}
