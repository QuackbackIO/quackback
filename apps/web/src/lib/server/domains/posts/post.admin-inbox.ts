/**
 * One page of the admin feedback list, with the pending merge suggestion
 * count of each post on it: the duplicate badge its row shows. Counting with
 * the page saves the list a second request per page for its badges.
 */
import type { PostId } from '@quackback/ids'
import { getMergeSuggestionCountsForPosts } from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'
import { listInboxPosts } from './post.inbox'

export async function listAdminInboxPage(params: Parameters<typeof listInboxPosts>[0]) {
  const page = await listInboxPosts(params)
  const duplicateCounts =
    page.items.length > 0
      ? await getMergeSuggestionCountsForPosts(page.items.map((p) => p.id as PostId))
      : []
  return { ...page, duplicateCounts }
}
