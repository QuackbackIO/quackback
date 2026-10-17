import {
  db,
  and,
  desc,
  eq,
  sql,
  posts,
  changelogEntries,
  changelogEntryPosts,
} from '@/lib/server/db'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { ChangelogId } from '@quackback/ids'
import { publicChangelogConditions } from '@/lib/server/domains/changelog/changelog.public'
import { getFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import { isProductEnabled } from '@/lib/shared/types/settings'

export interface PostChangelogLink {
  id: ChangelogId
  title: string
}

/**
 * Columns for a feed query over `posts`: the id and title of the newest public
 * changelog entry linked to each post, so a shipped idea can point at its
 * announcement. They are correlated subqueries, so the link costs no extra
 * round trip. Both are null when the changelog product is off.
 */
export async function changelogLinkColumns() {
  if (!isProductEnabled(await getFeatureFlags(), 'changelog')) {
    return {
      changelogEntryId: sql<ChangelogId | null>`null`,
      changelogEntryTitle: sql<string | null>`null`,
    }
  }
  const newest = (column: AnyPgColumn) =>
    db
      .select({ value: column })
      .from(changelogEntryPosts)
      .innerJoin(changelogEntries, eq(changelogEntries.id, changelogEntryPosts.changelogEntryId))
      .where(
        and(eq(changelogEntryPosts.postId, posts.id), ...publicChangelogConditions(new Date()))
      )
      .orderBy(desc(changelogEntries.publishedAt))
      .limit(1)
  return {
    changelogEntryId: sql<ChangelogId | null>`(${newest(changelogEntries.id)})`.mapWith(
      changelogEntries.id
    ),
    changelogEntryTitle: sql<string | null>`(${newest(changelogEntries.title)})`,
  }
}

/** The link a feed row carries, from the columns above. */
export function toChangelogLink(row: {
  changelogEntryId: ChangelogId | null
  changelogEntryTitle: string | null
}): PostChangelogLink | null {
  return row.changelogEntryId && row.changelogEntryTitle !== null
    ? { id: row.changelogEntryId, title: row.changelogEntryTitle }
    : null
}
