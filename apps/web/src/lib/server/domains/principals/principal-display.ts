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
import { supportContactName } from '@/lib/shared/support-contact-name'

/**
 * Display URL: the public URL of an uploaded key, else an OAuth/external URL.
 * An upload is the user's explicit choice (saveAvatarKeyFn sets the key
 * without clearing `image`; removing the avatar clears only the key), so it
 * must win over the provider picture — the same precedence as fetchUserAvatar
 * and the admin sidebar.
 *
 * User-row fields beat the principal mirror: `principal.avatar_*` drifts on
 * rows that pre-date syncPrincipalProfile being wired into every upload path.
 */
export function resolveUserAvatarUrl(opts: {
  userImage?: string | null
  userImageKey?: string | null
  principalAvatarUrl?: string | null
  principalAvatarKey?: string | null
}): string | null {
  return (
    getPublicUrlOrNull(opts.userImageKey) ??
    getPublicUrlOrNull(opts.principalAvatarKey) ??
    opts.userImage ??
    opts.principalAvatarUrl ??
    null
  )
}

type AuthorRow = {
  id: PrincipalId
  displayName: string | null
  accountName: string | null
  avatarUrl: string | null
  avatarKey: string | null
  userImage: string | null
  userImageKey: string | null
}

/** Public label, or the account name agents should see. */
function authorFromRow(row: AuthorRow, preferAccountName: boolean): ConversationAuthorDTO {
  const publicName = row.displayName ?? null
  return {
    principalId: row.id,
    displayName: preferAccountName
      ? supportContactName({
          accountName: row.accountName,
          publicName,
          fallback: '',
        }) || null
      : publicName,
    avatarUrl: resolveUserAvatarUrl({
      userImage: row.userImage,
      userImageKey: row.userImageKey,
      principalAvatarUrl: row.avatarUrl,
      principalAvatarKey: row.avatarKey,
    }),
  }
}

async function selectAuthorRows(
  ids: ReadonlyArray<PrincipalId | null | undefined>
): Promise<AuthorRow[]> {
  const unique = [...new Set(ids.filter((id): id is PrincipalId => !!id))]
  if (unique.length === 0) return []
  // Resolve the avatar from the linked user (the canonical source, like the
  // team-member list): the public URL of an uploaded avatar (stored only as an
  // S3 key), else an external image URL, falling back to the principal's synced
  // copy. principal.avatarUrl alone is not reliably kept in sync, so agents
  // whose avatar lives only on the user row would otherwise show initials.
  return db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      accountName: user.name,
      avatarUrl: principal.avatarUrl,
      avatarKey: principal.avatarKey,
      userImage: user.image,
      userImageKey: user.imageKey,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(inArray(principal.id, unique))
}

/**
 * Batch-load principal display info, returning a lookup map.
 *
 * `preferAccountName` is for agent support surfaces (the inbox list, the
 * thread, ticket requesters). It shows the account name. Posts, comments,
 * and requester reads leave it off, so they keep the public display name.
 */
export async function loadAuthors(
  ids: ReadonlyArray<PrincipalId | null | undefined>,
  opts?: { preferAccountName?: boolean }
): Promise<Map<PrincipalId, ConversationAuthorDTO>> {
  const map = new Map<PrincipalId, ConversationAuthorDTO>()
  for (const row of await selectAuthorRows(ids)) {
    map.set(row.id, authorFromRow(row, opts?.preferAccountName === true))
  }
  return map
}

/** Both labels from one read, so a send can fan each audience its own name. */
export async function loadAuthorAudiences(
  ids: ReadonlyArray<PrincipalId | null | undefined>
): Promise<
  Map<PrincipalId, { publicAuthor: ConversationAuthorDTO; supportAuthor: ConversationAuthorDTO }>
> {
  const map = new Map<
    PrincipalId,
    { publicAuthor: ConversationAuthorDTO; supportAuthor: ConversationAuthorDTO }
  >()
  for (const row of await selectAuthorRows(ids)) {
    map.set(row.id, {
      publicAuthor: authorFromRow(row, false),
      supportAuthor: authorFromRow(row, true),
    })
  }
  return map
}

export function fallbackAuthor(principalId: PrincipalId): ConversationAuthorDTO {
  return { principalId, displayName: null, avatarUrl: null }
}
