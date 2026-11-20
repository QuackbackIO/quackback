import type { PrincipalId } from '@quackback/ids'
import { principal, sql } from '@/lib/server/db'
import type { AnyColumn, SQL } from 'drizzle-orm'
import {
  loadApiKeyFeedbackAuthors,
  resolveUserAvatarUrl,
} from '@/lib/server/domains/principals/principal-display'

/**
 * Feedback items as a feedback reader sees them: an item an API key wrote
 * takes the key's customer-facing name, and its avatar when the item carries
 * one. `authors` are the caller's rows, each marked whether its author is an
 * API key (authorIsApiKeySql), so with no key among them nothing more is
 * read. Every other item is returned as it was read. See
 * loadApiKeyFeedbackAuthors for who shows as what.
 */
export async function withFeedbackAuthors<
  T extends { principalId: string; authorName: string | null; avatarUrl?: string | null },
>(items: T[], authors: ReadonlyArray<KeyFlaggedAuthor>): Promise<T[]> {
  const keyPrincipalIds = apiKeyAuthorIds(authors)
  if (keyPrincipalIds.length === 0) return items
  const keyAuthors = await loadApiKeyFeedbackAuthors(keyPrincipalIds as PrincipalId[])
  return items.map((item) => {
    const keyAuthor = keyAuthors.get(item.principalId as PrincipalId)
    if (!keyAuthor) return item
    const shown = { ...item, authorName: keyAuthor.displayName }
    return 'avatarUrl' in item ? { ...shown, avatarUrl: keyAuthor.avatarUrl } : shown
  })
}

/** Whether the principal a column points at is an API key, for a select list. */
export function authorIsApiKeySql(principalId: AnyColumn | SQL): SQL<boolean | null> {
  return sql<boolean | null>`(
    SELECT m.service_metadata->>'kind' = 'api_key' FROM ${principal} m WHERE m.id = ${principalId}
  )`
}

type KeyFlaggedAuthor = { principalId: string; authorIsApiKey: boolean | null }

/** The ids of the rows whose author is an API key. */
function apiKeyAuthorIds(rows: ReadonlyArray<KeyFlaggedAuthor>): string[] {
  return rows.filter((row) => row.authorIsApiKey).map((row) => row.principalId)
}

/** Resolve avatar URL — uploaded key first, then OAuth/external URL. */
export function resolveAvatarUrl(source: {
  avatarKey?: string | null
  avatarUrl?: string | null
  userImageKey?: string | null
  userImage?: string | null
}): string | null {
  return resolveUserAvatarUrl({
    userImage: source.userImage,
    userImageKey: source.userImageKey,
    principalAvatarUrl: source.avatarUrl,
    principalAvatarKey: source.avatarKey,
  })
}
