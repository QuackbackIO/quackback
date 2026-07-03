/**
 * Principal display resolution: name + avatar for a set of principal ids,
 * shared by every surface that renders "who" (the conversation inbox, tickets,
 * message streams). Lives in the principals domain because the avatar-precedence
 * rule is a principal concern, not a conversation one; the `ConversationAuthorDTO`
 * name is historical.
 */
import { db, principal, user, eq, inArray } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'

/** Batch-load principal display info, returning a lookup map. */
export async function loadAuthors(
  ids: ReadonlyArray<PrincipalId | null | undefined>
): Promise<Map<PrincipalId, ConversationAuthorDTO>> {
  const unique = [...new Set(ids.filter((id): id is PrincipalId => !!id))]
  const map = new Map<PrincipalId, ConversationAuthorDTO>()
  if (unique.length === 0) return map
  // Resolve the avatar from the linked user (the canonical source, like the
  // team-member list): an external image URL, or the public URL of an uploaded
  // avatar (stored only as an S3 key), falling back to the principal's synced
  // copy. principal.avatarUrl alone is not reliably kept in sync, so agents
  // whose avatar lives only on the user row would otherwise show initials.
  const rows = await db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
      userImage: user.image,
      userImageKey: user.imageKey,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(inArray(principal.id, unique))
  for (const row of rows) {
    map.set(row.id, {
      principalId: row.id,
      displayName: row.displayName ?? null,
      avatarUrl: row.userImage ?? getPublicUrlOrNull(row.userImageKey) ?? row.avatarUrl ?? null,
    })
  }
  return map
}

export function fallbackAuthor(principalId: PrincipalId): ConversationAuthorDTO {
  return { principalId, displayName: null, avatarUrl: null }
}
