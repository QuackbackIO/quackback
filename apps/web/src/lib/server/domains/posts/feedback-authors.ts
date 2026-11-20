import type { PrincipalId } from '@quackback/ids'
import { loadApiKeyFeedbackAuthors } from '@/lib/server/domains/principals/principal-display'

/**
 * Feedback items as a feedback reader sees them: an item an API key wrote
 * takes the key's customer-facing name, and its avatar when the item carries
 * one. Every other item is returned as it was read. See
 * loadApiKeyFeedbackAuthors for who shows as what.
 */
export async function withFeedbackAuthors<
  T extends { principalId: string; authorName: string | null; avatarUrl?: string | null },
>(items: T[]): Promise<T[]> {
  const keyAuthors = await loadApiKeyFeedbackAuthors(
    items.map((item) => item.principalId as PrincipalId)
  )
  if (keyAuthors.size === 0) return items
  return items.map((item) => {
    const keyAuthor = keyAuthors.get(item.principalId as PrincipalId)
    if (!keyAuthor) return item
    const shown = { ...item, authorName: keyAuthor.displayName }
    return 'avatarUrl' in item ? { ...shown, avatarUrl: keyAuthor.avatarUrl } : shown
  })
}
