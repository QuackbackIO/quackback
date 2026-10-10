import {
  db,
  helpCenterArticles,
  principal,
  user,
  eq,
  and,
  isNull,
  isNotNull,
  desc,
  asc,
  inArray,
} from '@/lib/server/db'
import { resolveUserAvatarUrl } from '@/lib/server/domains/principals/principal-display'

/** Facepile authors for each public help-center category page. */
export async function listPublicCategoryEditors(): Promise<
  Record<string, Array<{ name: string; avatarUrl: string | null }>>
> {
  const rows = await db
    .select({
      categoryId: helpCenterArticles.categoryId,
      principalId: helpCenterArticles.principalId,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
      avatarKey: principal.avatarKey,
      userImage: user.image,
      userImageKey: user.imageKey,
    })
    .from(helpCenterArticles)
    .innerJoin(principal, eq(principal.id, helpCenterArticles.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(
      and(
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt),
        eq(principal.type, 'user'),
        inArray(principal.role, ['admin', 'member'])
      )
    )
    .orderBy(asc(helpCenterArticles.categoryId), desc(helpCenterArticles.publishedAt))

  const result: Record<string, Array<{ name: string; avatarUrl: string | null }>> = {}
  const seen = new Set<string>()
  for (const row of rows) {
    const catId = row.categoryId as string
    const key = `${catId}:${row.principalId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!result[catId]) result[catId] = []
    if (result[catId].length < 3 && row.displayName) {
      result[catId].push({
        name: row.displayName,
        avatarUrl: resolveUserAvatarUrl({
          userImage: row.userImage,
          userImageKey: row.userImageKey,
          principalAvatarUrl: row.avatarUrl,
          principalAvatarKey: row.avatarKey,
        }),
      })
    }
  }
  return result
}
