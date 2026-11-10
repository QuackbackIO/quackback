/**
 * What the designer's page switcher lists: the boards, roadmaps and help
 * topics a signed-out visitor can open, and the top posts, latest entries and
 * first articles to choose one from. Whoever is designing, nothing a
 * signed-out visitor could not open is among them.
 */
import { ANONYMOUS_ACTOR } from '@/lib/server/policy'
import { logger } from '@/lib/server/logger'
import { listPublicBoardsWithStats } from '@/lib/server/domains/boards/board.public'
import { listPublicRoadmaps } from '@/lib/server/domains/roadmaps/roadmap.service'
import { listPublicCategories } from '@/lib/server/domains/help-center/help-center.category.service'
import { listPublicArticlesForCategories } from '@/lib/server/domains/help-center/help-center.article.query'
import { listPublicChangelogs } from '@/lib/server/domains/changelog/changelog.public'
import { listPublicStatuses } from '@/lib/server/domains/statuses/status.service'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { hcArticlePath, hcCollectionPath } from '@/lib/shared/help-center-url'
import type { DesignerPlaces } from '@/lib/shared/design/page-switcher'
import { DESIGNER_POST_LIMIT, listDesignerPosts } from './designer-posts'

/** How many of each list "Choose one" offers; it has no search of its own. */
const LIMIT = DESIGNER_POST_LIMIT

/** One list's answer, or none when its part is off or cannot be read. */
async function orNone<T>(list: string, read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read()
  } catch (error) {
    logger.warn({ err: error, list }, 'designer places: a list could not be read')
    return []
  }
}

/** The public roadmaps' columns, each by its status once, in the roadmaps' order. */
export function roadmapColumnPlaces(
  roadmaps: ReadonlyArray<{
    columns: ReadonlyArray<{ statusId?: string | null; name: string }>
  }>
): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const roadmap of roadmaps)
    for (const column of roadmap.columns)
      if (column.statusId && !seen.has(column.statusId)) seen.set(column.statusId, column.name)
  return [...seen].map(([id, name]) => ({ id, name }))
}

export async function listDesignerPlaces(): Promise<DesignerPlaces> {
  const [boards, roadmaps, categories, posts, entries, statuses] = await Promise.all([
    orNone('boards', () => listPublicBoardsWithStats(ANONYMOUS_ACTOR)),
    orNone('roadmaps', () => listPublicRoadmaps(ANONYMOUS_ACTOR)),
    orNone('categories', () => listPublicCategories(ANONYMOUS_ACTOR)),
    orNone('posts', () => listDesignerPosts()),
    orNone(
      'entries',
      async () => (await listPublicChangelogs({ limit: LIMIT }, ANONYMOUS_ACTOR)).items
    ),
    orNone('statuses', () => listPublicStatuses()),
  ])
  const topics = categories
    .filter((category) => !category.parentId)
    .sort((a, b) => a.position - b.position)
  const grouped = await orNone('articles', async () => [
    await listPublicArticlesForCategories(
      topics.map((topic) => topic.id),
      ANONYMOUS_ACTOR
    ),
  ])
  const articles = topics.flatMap((topic) => grouped[0]?.get(topic.id) ?? []).slice(0, LIMIT)
  return {
    boards: boards.map((board) => ({ id: board.id, name: board.name, slug: board.slug })),
    roadmaps: roadmaps.map((roadmap) => ({ id: roadmap.id, name: roadmap.name })),
    columns: roadmapColumnPlaces(roadmaps),
    statuses: statuses.map((status) => ({ id: status.id, name: status.name })),
    categories: topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      path: hcCollectionPath({ locale: DEFAULT_LOCALE, urlId: topic.urlId, slug: topic.slug }),
    })),
    posts,
    entries: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      path: `/changelog/${entry.id}`,
    })),
    articles: articles.map((article) => ({
      id: article.id,
      title: article.title,
      path: hcArticlePath({ locale: DEFAULT_LOCALE, urlId: article.urlId, slug: article.slug }),
    })),
  }
}
