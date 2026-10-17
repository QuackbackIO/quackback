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
import { fromUuid, type ChangelogId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'
import { publicChangelogConditions } from '@/lib/server/domains/changelog/changelog.public'
import { categoryGateCondition } from '@/lib/server/domains/changelog/changelog-category.service'
import { getFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import { isProductEnabled } from '@/lib/shared/types/settings'

export interface PostChangelogLink {
  id: ChangelogId
  title: string
}

/** The column's raw value: the entry id is the stored uuid. */
type RawChangelogLink = { id: string; title: string } | null

/**
 * A column for a feed query over `posts`: the newest changelog entry linked to
 * each post that `actor` may read, so a shipped idea can point at its
 * announcement. One correlated subquery, so it costs no extra round trip.
 * Null when not requested or when the changelog product is off.
 */
export async function changelogLinkColumn(actor: Actor, requested: boolean | undefined) {
  if (!requested || !isProductEnabled(await getFeatureFlags(), 'changelog')) {
    return sql<RawChangelogLink | string>`null`
  }
  const newest = db
    .select({
      link: sql`json_build_object('id', ${changelogEntries.id}, 'title', ${changelogEntries.title})`,
    })
    .from(changelogEntryPosts)
    .innerJoin(changelogEntries, eq(changelogEntries.id, changelogEntryPosts.changelogEntryId))
    .where(
      and(
        eq(changelogEntryPosts.postId, posts.id),
        ...publicChangelogConditions(new Date()),
        categoryGateCondition(actor, changelogEntries.id)
      )
    )
    .orderBy(desc(changelogEntries.publishedAt))
    .limit(1)
  return sql<RawChangelogLink | string>`(${newest})`
}

/** The link a feed row carries, from the column above. */
export function toChangelogLink(raw: RawChangelogLink | string): PostChangelogLink | null {
  const link: RawChangelogLink = typeof raw === 'string' ? JSON.parse(raw) : raw
  return link ? { id: fromUuid('changelog', link.id), title: link.title } : null
}
