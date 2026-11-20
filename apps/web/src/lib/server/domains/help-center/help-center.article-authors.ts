/**
 * Who the public help center shows as the author of an article an API key
 * wrote: the support team with no avatar, or a personal key's creator, the rule
 * feedback and support follow (loadApiKeyFeedbackAuthors). The team's views
 * (admin, REST, MCP) keep the key's own name and do not use this.
 */
import { principal, sql } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { loadApiKeyFeedbackAuthors } from '@/lib/server/domains/principals/principal-display'

/**
 * Whether the joined author is an API key, read from the principal row the
 * list already joins (no extra query).
 */
export const AUTHOR_IS_API_KEY = sql<
  boolean | null
>`(${principal.serviceMetadata}->>'kind' = 'api_key')`

type KeyFlaggedArticleRow = {
  authorPrincipalId: string | null
  authorIsApiKey: boolean | null
  authorName: string | null
  authorAvatarUrl: string | null
}

/**
 * A public article list as the help center shows it: an article an API key
 * wrote shows the support team with no avatar, or a personal key's creator
 * (loadApiKeyFeedbackAuthors), never the key's own name. Reads more only when
 * a row's author is a key. Drops the author id and key flag the rows carried
 * for this, so the list's shape is unchanged.
 */
export async function withPublicArticleAuthors<T extends KeyFlaggedArticleRow>(
  rows: T[]
): Promise<Array<Omit<T, 'authorPrincipalId' | 'authorIsApiKey'>>> {
  const keyIds = rows.flatMap((row) =>
    row.authorIsApiKey && row.authorPrincipalId ? [row.authorPrincipalId as PrincipalId] : []
  )
  const keyAuthors = keyIds.length > 0 ? await loadApiKeyFeedbackAuthors(keyIds) : null
  return rows.map(({ authorPrincipalId, authorIsApiKey: _flag, ...row }) => {
    const keyAuthor = authorPrincipalId
      ? keyAuthors?.get(authorPrincipalId as PrincipalId)
      : undefined
    return keyAuthor
      ? { ...row, authorName: keyAuthor.displayName, authorAvatarUrl: keyAuthor.avatarUrl }
      : row
  })
}
