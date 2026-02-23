import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'
import { db, changelogEntries, desc, eq, isNotNull, lte } from '@/lib/server/db'
import { renderSitemap, toW3CDate } from '@/lib/server/sitemap'
import type { SitemapUrl } from '@/lib/server/sitemap'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const pageParam = url.searchParams.get('page')
        const page = pageParam ? parseInt(pageParam, 10) : null

        const baseUrl = config.baseUrl
        const allUrls = await collectUrls(baseUrl)

        const xml = renderSitemap(allUrls, baseUrl, isNaN(page as number) ? null : page)

        if (!xml) {
          return new Response('Not Found', { status: 404 })
        }

        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      },
    },
  },
})

async function collectUrls(baseUrl: string): Promise<SitemapUrl[]> {
  const urls: SitemapUrl[] = []

  // Static pages
  urls.push({ loc: baseUrl })
  urls.push({ loc: `${baseUrl}/roadmap` })
  urls.push({ loc: `${baseUrl}/changelog` })

  // Published changelog entries
  const entries = await db.query.changelogEntries.findMany({
    where: (table, { and }) =>
      and(isNotNull(table.publishedAt), lte(table.publishedAt, new Date())),
    orderBy: [desc(changelogEntries.publishedAt)],
    columns: { id: true, updatedAt: true },
  })

  for (const entry of entries) {
    urls.push({
      loc: `${baseUrl}/changelog/${entry.id}`,
      lastmod: toW3CDate(entry.updatedAt),
    })
  }

  // Published, non-merged posts on public, non-deleted boards
  const publicPosts = await db.query.posts.findMany({
    where: (table, { and, isNull }) =>
      and(
        isNull(table.deletedAt),
        eq(table.moderationState, 'published'),
        isNull(table.canonicalPostId)
      ),
    columns: { id: true, updatedAt: true },
    with: {
      board: {
        columns: { slug: true, isPublic: true, deletedAt: true },
      },
    },
  })

  for (const post of publicPosts) {
    if (post.board?.slug && post.board.isPublic && !post.board.deletedAt) {
      urls.push({
        loc: `${baseUrl}/b/${post.board.slug}/posts/${post.id}`,
        lastmod: toW3CDate(post.updatedAt),
      })
    }
  }

  return urls
}
