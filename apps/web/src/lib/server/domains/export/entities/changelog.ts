/**
 * Changelog entries exporter.
 */
import { db, changelogEntries, asc, isNull } from '@/lib/server/db'
import { escapeCSV } from '@/lib/server/utils/csv'
import type { EntityExporter } from '../types'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '')

async function fetchChangelog(offset: number, limit: number) {
  return db.query.changelogEntries.findMany({
    where: isNull(changelogEntries.deletedAt),
    orderBy: asc(changelogEntries.createdAt),
    offset,
    limit,
    columns: {
      id: true,
      title: true,
      content: true,
      publishedAt: true,
      displayDate: true,
      viewCount: true,
      createdAt: true,
      updatedAt: true,
    },
  })
}
type ChangelogRow = Awaited<ReturnType<typeof fetchChangelog>>[number]

export const changelogExporter: EntityExporter<ChangelogRow> = {
  key: 'changelog_entries',
  fileName: 'changelog.csv',
  pageSize: 5000,
  header: 'id,title,content,published_at,display_date,view_count,created_at,updated_at',
  fetchPage: fetchChangelog,
  serialize: (e) =>
    [
      e.id,
      escapeCSV(e.title),
      escapeCSV(e.content),
      iso(e.publishedAt),
      iso(e.displayDate),
      String(e.viewCount),
      iso(e.createdAt),
      iso(e.updatedAt),
    ].join(','),
}
