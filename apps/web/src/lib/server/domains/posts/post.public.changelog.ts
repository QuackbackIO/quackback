import { db, and, desc, eq, inArray, changelogEntries, changelogEntryPosts } from '@/lib/server/db'
import type { ChangelogId, PostId } from '@quackback/ids'
import { publicChangelogConditions } from '@/lib/server/domains/changelog/changelog.public'
import { getFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import { isProductEnabled } from '@/lib/shared/types/settings'

export interface PostChangelogLink {
  id: ChangelogId
  title: string
}

/**
 * The newest public changelog entry linked to each post on a page, so a
 * shipped idea in the feed can point at the announcement. Empty when the
 * changelog product is off, so no entry is exposed and no query runs.
 */
export async function getChangelogLinksForPosts(
  postIds: PostId[]
): Promise<Map<PostId, PostChangelogLink>> {
  const links = new Map<PostId, PostChangelogLink>()
  if (postIds.length === 0 || !isProductEnabled(await getFeatureFlags(), 'changelog')) {
    return links
  }

  const rows = await db
    .selectDistinctOn([changelogEntryPosts.postId], {
      postId: changelogEntryPosts.postId,
      id: changelogEntries.id,
      title: changelogEntries.title,
    })
    .from(changelogEntryPosts)
    .innerJoin(changelogEntries, eq(changelogEntries.id, changelogEntryPosts.changelogEntryId))
    .where(
      and(inArray(changelogEntryPosts.postId, postIds), ...publicChangelogConditions(new Date()))
    )
    .orderBy(changelogEntryPosts.postId, desc(changelogEntries.publishedAt))

  for (const row of rows) links.set(row.postId, { id: row.id, title: row.title })
  return links
}
