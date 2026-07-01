/**
 * Conversation tag service — agent-managed tags for the support inbox.
 *
 * Deliberately separate from the feedback tag service (`domains/post-tags`): different
 * tables, ids, and lifecycle, so a conversation tag never leaks into feedback
 * boards and vice-versa. Tags are org-wide, created on the fly from a
 * conversation, and used to filter the inbox. Authorization is enforced at the
 * server-fn layer, not here.
 */
import {
  db,
  eq,
  and,
  isNull,
  asc,
  sql,
  conversationTags,
  conversationTagAssignments,
  conversations,
  type ConversationTag,
} from '@/lib/server/db'
import type { ConversationTagId, ConversationId } from '@quackback/ids'
import { ValidationError, NotFoundError } from '@/lib/shared/errors'
import type { ConversationTagDTO } from '@/lib/shared/chat/types'

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const DEFAULT_COLOR = '#6b7280'

/**
 * Validate + normalize a new-tag input. Pure (no I/O) so it's unit-tested
 * directly; the create path below relies on it.
 */
export function normalizeConversationTagInput(input: { name: string; color?: string }): {
  name: string
  color: string
} {
  const name = input.name?.trim() ?? ''
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'PostTag name is required')
  if (name.length > 50) {
    throw new ValidationError('VALIDATION_ERROR', 'PostTag name must not exceed 50 characters')
  }
  const color = input.color || DEFAULT_COLOR
  if (!HEX_COLOR.test(color)) {
    throw new ValidationError('VALIDATION_ERROR', 'Color must be a valid hex color (e.g., #6b7280)')
  }
  return { name, color }
}

/**
 * Would renaming `targetId` to `name` collide with a DIFFERENT live tag?
 * Case-insensitive + trimmed, and never flags a tag against its own current name
 * (so a pure recolor or a casing tweak is allowed). Pure (no I/O) so the rename
 * guard is unit-tested directly; `updateConversationTag` composes it with the live-tag
 * fetch.
 */
export function hasNameConflict(
  targetId: ConversationTagId,
  name: string,
  liveTags: { id: ConversationTagId; name: string }[]
): boolean {
  const needle = name.trim().toLowerCase()
  return liveTags.some((t) => t.id !== targetId && t.name.toLowerCase() === needle)
}

const toDTO = (t: { id: ConversationTagId; name: string; color: string }): ConversationTagDTO => ({
  id: t.id,
  name: t.name,
  color: t.color,
})

/**
 * Find-or-create a conversation tag by name (case-insensitive, among non-deleted).
 * Idempotent so creating a tag inline from a conversation never errors on a name that
 * already exists — it just reuses the existing one.
 */
export async function createConversationTag(input: {
  name: string
  color?: string
}): Promise<ConversationTag> {
  const { name, color } = normalizeConversationTagInput(input)
  // Reuse a LIVE label with the same name (case-insensitive) so inline creation
  // is idempotent — a targeted lower(name) lookup rather than scanning every tag.
  const dup = await db.query.conversationTags.findFirst({
    where: and(
      isNull(conversationTags.deletedAt),
      sql`lower(${conversationTags.name}) = ${name.toLowerCase()}`
    ),
  })
  if (dup) return dup
  // The name unique constraint spans soft-deleted rows, and a concurrent create
  // could race the find above. onConflictDoUpdate resurrects a soft-deleted
  // same-name row (clearing deletedAt) and resolves the race to one winning row,
  // so this never surfaces a raw unique-violation.
  const [created] = await db
    .insert(conversationTags)
    .values({ name, color })
    .onConflictDoUpdate({ target: conversationTags.name, set: { deletedAt: null } })
    .returning()
  return created
}

/** All non-deleted conversation tags, ordered by name. */
export async function listConversationTags(): Promise<ConversationTagDTO[]> {
  const rows = await db.query.conversationTags.findMany({
    where: isNull(conversationTags.deletedAt),
    orderBy: [asc(conversationTags.name)],
  })
  return rows.map(toDTO)
}

/**
 * Non-deleted conversation tags with the count of OPEN conversations each is applied to.
 * Scoped to `status='open'` so the nav badge is an actionable signal that
 * matches the default inbox view (open) rather than an all-status total the
 * filtered list never shows. The open filter lives in the LEFT JOIN's ON clause
 * so tags with no open conversations still appear with a count of 0.
 */
export async function listConversationTagsWithCounts(): Promise<
  (ConversationTagDTO & { count: number })[]
> {
  const rows = await db
    .select({
      id: conversationTags.id,
      name: conversationTags.name,
      color: conversationTags.color,
      count: sql<number>`count(${conversations.id})::int`,
    })
    .from(conversationTags)
    .leftJoin(
      conversationTagAssignments,
      eq(conversationTagAssignments.conversationTagId, conversationTags.id)
    )
    .leftJoin(
      conversations,
      and(
        eq(conversations.id, conversationTagAssignments.conversationId),
        eq(conversations.status, 'open')
      )
    )
    .where(isNull(conversationTags.deletedAt))
    .groupBy(conversationTags.id, conversationTags.name, conversationTags.color)
    .orderBy(asc(conversationTags.name))
  return rows.map((r) => ({ ...toDTO(r), count: r.count }))
}

/**
 * Rename and/or recolor a live tag. Renaming onto another live tag's name
 * (case-insensitive) is rejected rather than merged, so the taxonomy can't grow
 * silent duplicates. A pure recolor (or a casing-only rename) passes. Returns
 * the updated tag; throws NotFound if the id is missing or already soft-deleted.
 */
export async function updateConversationTag(
  id: ConversationTagId,
  input: { name?: string; color?: string }
): Promise<ConversationTagDTO> {
  const patch: { name?: string; color?: string } = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new ValidationError('VALIDATION_ERROR', 'PostTag name is required')
    if (name.length > 50) {
      throw new ValidationError('VALIDATION_ERROR', 'PostTag name must not exceed 50 characters')
    }
    const live = await db.query.conversationTags.findMany({
      where: isNull(conversationTags.deletedAt),
      columns: { id: true, name: true },
    })
    if (hasNameConflict(id, name, live)) {
      throw new ValidationError('VALIDATION_ERROR', 'A tag with that name already exists')
    }
    patch.name = name
  }
  if (input.color !== undefined) {
    if (!HEX_COLOR.test(input.color)) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Color must be a valid hex color (e.g., #6b7280)'
      )
    }
    patch.color = input.color
  }
  // Nothing to change (defensive — the server fn requires ≥1 field): return the
  // current row rather than running an empty UPDATE.
  if (Object.keys(patch).length === 0) {
    const current = await db.query.conversationTags.findFirst({
      where: and(eq(conversationTags.id, id), isNull(conversationTags.deletedAt)),
    })
    if (!current) throw new NotFoundError('TAG_NOT_FOUND', `Conversation tag ${id} not found`)
    return toDTO(current)
  }
  let row
  try {
    ;[row] = await db
      .update(conversationTags)
      .set(patch)
      .where(and(eq(conversationTags.id, id), isNull(conversationTags.deletedAt)))
      .returning()
  } catch (err) {
    // The name unique constraint spans soft-deleted rows, and a concurrent
    // rename could race the live-name check above — both cases collide only at
    // the DB. Translate the raw unique-violation into the same ValidationError
    // the pre-check throws (mirrors createConversationTag absorbing the constraint)
    // rather than surfacing a 500.
    if ((err as { code?: string }).code === '23505') {
      throw new ValidationError('VALIDATION_ERROR', 'A tag with that name already exists')
    }
    throw err
  }
  if (!row) throw new NotFoundError('TAG_NOT_FOUND', `Conversation tag ${id} not found`)
  return toDTO(row)
}

/**
 * Soft-delete a conversation tag. The row stays (so history isn't rewritten) but is
 * filtered from every list by the `deleted_at IS NULL` predicate; any existing
 * conversation_tags rows pointing at it become inert.
 */
export async function deleteConversationTag(id: ConversationTagId): Promise<void> {
  const result = await db
    .update(conversationTags)
    .set({ deletedAt: new Date() })
    .where(and(eq(conversationTags.id, id), isNull(conversationTags.deletedAt)))
    .returning()
  if (result.length === 0)
    throw new NotFoundError('TAG_NOT_FOUND', `Conversation tag ${id} not found`)
}

/** Tags applied to one conversation (non-deleted), ordered by name. */
export async function listTagsForConversation(
  conversationId: ConversationId
): Promise<ConversationTagDTO[]> {
  const rows = await db
    .select({ id: conversationTags.id, name: conversationTags.name, color: conversationTags.color })
    .from(conversationTagAssignments)
    .innerJoin(
      conversationTags,
      eq(conversationTagAssignments.conversationTagId, conversationTags.id)
    )
    .where(
      and(
        eq(conversationTagAssignments.conversationId, conversationId),
        isNull(conversationTags.deletedAt)
      )
    )
    .orderBy(asc(conversationTags.name))
  return rows.map(toDTO)
}

/** Attach a tag to a conversation (idempotent). Returns the updated tag list. */
export async function attachTag(
  conversationId: ConversationId,
  conversationTagId: ConversationTagId
): Promise<ConversationTagDTO[]> {
  await db
    .insert(conversationTagAssignments)
    .values({ conversationId, conversationTagId })
    .onConflictDoNothing()
  return listTagsForConversation(conversationId)
}

/** Detach a tag from a conversation. Returns the updated tag list. */
export async function detachTag(
  conversationId: ConversationId,
  conversationTagId: ConversationTagId
): Promise<ConversationTagDTO[]> {
  await db
    .delete(conversationTagAssignments)
    .where(
      and(
        eq(conversationTagAssignments.conversationId, conversationId),
        eq(conversationTagAssignments.conversationTagId, conversationTagId)
      )
    )
  return listTagsForConversation(conversationId)
}
