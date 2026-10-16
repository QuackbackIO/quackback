import {
  db,
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  changelogEntries,
  changelogEntryPosts,
} from '@/lib/server/db'
import type { ChangelogId, PostId } from '@quackback/ids'

export interface PostChangelogLink {
  id: ChangelogId
  title: string
}

/**
 * The newest published changelog entry linked to each post on a page, so a
 * shipped idea in the feed can point at the announcement. Drafts, scheduled
 * and deleted entries are skipped.
 */
export async function getChangelogLinksForPosts(
  postIds: PostId[]
): Promise<Map<PostId, PostChangelogLink>> {
  const links = new Map<PostId, PostChangelogLink>()
  if (postIds.length === 0) return links

  const rows = await db
    .select({
      postId: changelogEntryPosts.postId,
      id: changelogEntries.id,
      title: changelogEntries.title,
    })
    .from(changelogEntryPosts)
    .innerJoin(changelogEntries, eq(changelogEntries.id, changelogEntryPosts.changelogEntryId))
    .where(
      and(
        inArray(changelogEntryPosts.postId, postIds),
        isNull(changelogEntries.deletedAt),
        isNotNull(changelogEntries.publishedAt),
        lte(changelogEntries.publishedAt, new Date())
      )
    )
    .orderBy(desc(changelogEntries.publishedAt))

  for (const row of rows) {
    if (!links.has(row.postId)) links.set(row.postId, { id: row.id, title: row.title })
  }
  return links
}
