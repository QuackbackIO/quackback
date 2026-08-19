/**
 * Posts exporter — mirrors the interactive /api/export CSV columns, plus the
 * post id so comments.csv / votes.csv rows can be cross-referenced. Uncapped
 * and paged, unlike listPostsForExport (10k cap for the interactive route).
 */
import { db, posts, postStatuses, asc, and, inArray, isNull } from '@/lib/server/db'
import { escapeCSV } from '@/lib/server/utils/csv'
import { realEmail } from '@/lib/shared/anonymous-email'
import type { EntityExporter } from '../types'

async function fetchPosts(offset: number, limit: number) {
  const page = await db.query.posts.findMany({
    where: isNull(posts.deletedAt),
    orderBy: asc(posts.createdAt),
    offset,
    limit,
    columns: {
      id: true,
      title: true,
      content: true,
      statusId: true,
      voteCount: true,
      createdAt: true,
    },
    with: {
      board: { columns: { slug: true } },
      tags: { with: { tag: { columns: { name: true } } } },
      author: { columns: { displayName: true }, with: { user: { columns: { email: true } } } },
    },
  })

  const statusIds = [...new Set(page.filter((p) => p.statusId).map((p) => p.statusId!))]
  const statusRows =
    statusIds.length > 0
      ? await db.query.postStatuses.findMany({
          where: and(inArray(postStatuses.id, statusIds)),
          columns: { id: true, name: true },
        })
      : []
  const statusNames = new Map(statusRows.map((s) => [s.id, s.name]))

  return page.map((p) => ({
    ...p,
    statusName: p.statusId ? (statusNames.get(p.statusId) ?? '') : '',
  }))
}
type PostRow = Awaited<ReturnType<typeof fetchPosts>>[number]

export const postsExporter: EntityExporter<PostRow> = {
  key: 'posts',
  fileName: 'posts.csv',
  pageSize: 5000,
  header: 'id,title,content,status,tags,board,author_name,author_email,vote_count,created_at',
  fetchPage: fetchPosts,
  serialize: (p) =>
    [
      p.id,
      escapeCSV(p.title),
      escapeCSV(p.content),
      escapeCSV(p.statusName),
      escapeCSV(p.tags.map((t) => t.tag.name).join(',')),
      escapeCSV(p.board.slug),
      escapeCSV(p.author?.displayName ?? ''),
      escapeCSV(realEmail(p.author?.user?.email) ?? ''),
      String(p.voteCount),
      p.createdAt.toISOString(),
    ].join(','),
}
