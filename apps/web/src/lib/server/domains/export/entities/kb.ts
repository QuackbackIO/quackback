/**
 * Help center (KB) articles exporter.
 */
import { db, helpCenterArticles, asc, isNull } from '@/lib/server/db'
import { escapeCSV } from '@/lib/server/utils/csv'
import type { EntityExporter } from '../types'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '')

async function fetchArticles(offset: number, limit: number) {
  return db.query.helpCenterArticles.findMany({
    where: isNull(helpCenterArticles.deletedAt),
    orderBy: asc(helpCenterArticles.createdAt),
    offset,
    limit,
    columns: {
      id: true,
      slug: true,
      title: true,
      description: true,
      content: true,
      publishedAt: true,
      viewCount: true,
      helpfulCount: true,
      notHelpfulCount: true,
      createdAt: true,
    },
    with: {
      category: { columns: { slug: true } },
    },
  })
}
type ArticleRow = Awaited<ReturnType<typeof fetchArticles>>[number]

export const kbArticlesExporter: EntityExporter<ArticleRow> = {
  key: 'kb_articles',
  fileName: 'kb_articles.csv',
  pageSize: 5000,
  header:
    'id,category,slug,title,description,content,published_at,view_count,helpful_count,not_helpful_count,created_at',
  fetchPage: fetchArticles,
  serialize: (a) =>
    [
      a.id,
      escapeCSV(a.category.slug),
      escapeCSV(a.slug),
      escapeCSV(a.title),
      escapeCSV(a.description ?? ''),
      escapeCSV(a.content),
      iso(a.publishedAt),
      String(a.viewCount),
      String(a.helpfulCount),
      String(a.notHelpfulCount),
      iso(a.createdAt),
    ].join(','),
}
