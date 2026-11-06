/**
 * One page of the admin feedback list, with the pending merge suggestion
 * count of each post on it: the duplicate badge its row shows. Counting with
 * the page saves the list a second request per page for its badges. A search
 * that matches no post on every word is widened first (withInboxSearchMode),
 * and the page says how.
 */
import type { PostId } from '@quackback/ids'
import { getMergeSuggestionCountsForPosts } from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'
import { listInboxPosts } from './post.inbox'
import { withInboxSearchMode } from './post.inbox.search'

export async function listAdminInboxPage(
  params: Parameters<typeof listInboxPosts>[0],
  options?: { pendingDuplicates?: boolean }
) {
  const listParams = await withInboxSearchMode(params, options)
  const page = await listInboxPosts(listParams)
  const duplicateCounts =
    page.items.length > 0
      ? await getMergeSuggestionCountsForPosts(page.items.map((p) => p.id as PostId))
      : []
  return {
    ...page,
    duplicateCounts,
    ...(listParams.searchMode !== 'all' && { searchMode: listParams.searchMode }),
  }
}
