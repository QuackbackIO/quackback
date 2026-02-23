import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'
import { db, changelogEntries, desc, isNotNull, lte } from '@/lib/server/db'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const baseUrl = config.baseUrl

        const urls: Array<{ loc: string; changefreq: string; priority: string }> = []

        // Static pages
        urls.push({ loc: baseUrl, changefreq: 'daily', priority: '1.0' })
        urls.push({ loc: `${baseUrl}/roadmap`, changefreq: 'daily', priority: '0.8' })
        urls.push({ loc: `${baseUrl}/changelog`, changefreq: 'weekly', priority: '0.8' })

        // Published changelog entries
        const entries = await db.query.changelogEntries.findMany({
          where: (table, { and }) =>
            and(isNotNull(table.publishedAt), lte(table.publishedAt, new Date())),
          orderBy: [desc(changelogEntries.publishedAt)],
          columns: { id: true },
        })

        for (const entry of entries) {
          urls.push({
            loc: `${baseUrl}/changelog/${entry.id}`,
            changefreq: 'monthly',
            priority: '0.6',
          })
        }

        // Published, non-merged posts with their board slugs
        const publicPosts = await db.query.posts.findMany({
          where: (table, { and, isNull, eq }) =>
            and(
              isNull(table.deletedAt),
              eq(table.moderationState, 'published'),
              isNull(table.canonicalPostId)
            ),
          columns: { id: true },
          with: {
            board: { columns: { slug: true } },
          },
          limit: 5000,
        })

        for (const post of publicPosts) {
          if (post.board?.slug) {
            urls.push({
              loc: `${baseUrl}/b/${post.board.slug}/posts/${post.id}`,
              changefreq: 'weekly',
              priority: '0.5',
            })
          }
        }

        const xml = buildSitemap(urls)

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

function buildSitemap(urls: Array<{ loc: string; changefreq: string; priority: string }>): string {
  const escapeXml = (str: string): string => {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  const urlEntries = urls
    .map(
      (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`
}
