import { createFileRoute } from '@tanstack/react-router'
import type { SitemapUrl } from '@/lib/server/sitemap'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ config }, { renderSitemap }] = await Promise.all([
          import('@/lib/server/config'),
          import('@/lib/server/sitemap'),
        ])

        const url = new URL(request.url)
        const pageParam = url.searchParams.get('page')
        const page = pageParam ? parseInt(pageParam, 10) : null

        const baseUrl = config.baseUrl

        // Private portals must not expose URLs to search engines.
        const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
        const tenant = await getTenantSettings()
        if (tenant?.portalConfig?.access?.visibility === 'private') {
          return new Response(renderSitemap([], baseUrl, null) ?? '', {
            headers: {
              'Content-Type': 'application/xml; charset=utf-8',
              'Cache-Control': 'public, max-age=3600',
            },
          })
        }

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
  const [
    { db, changelogEntries, and, desc, eq, sql },
    { publicChangelogConditions },
    { toIsoDateOnly },
  ] = await Promise.all([
    import('@/lib/server/db'),
    import('@/lib/server/domains/changelog/changelog.public'),
    import('@/lib/shared/utils/date'),
  ])

  const effectiveDisplayDate = sql<Date>`coalesce(${changelogEntries.displayDate}, ${changelogEntries.publishedAt})`

  const urls: SitemapUrl[] = []

  // Static pages
  urls.push({ loc: baseUrl })
  urls.push({ loc: `${baseUrl}/roadmap` })
  urls.push({ loc: `${baseUrl}/changelog` })

  const entries = await db
    .select({ id: changelogEntries.id, updatedAt: changelogEntries.updatedAt })
    .from(changelogEntries)
    .where(and(...publicChangelogConditions(new Date())))
    .orderBy(desc(effectiveDisplayDate))

  for (const entry of entries) {
    urls.push({
      loc: `${baseUrl}/changelog/${entry.id}`,
      lastmod: toIsoDateOnly(entry.updatedAt),
    })
  }

  // Published, non-merged posts on public, non-deleted boards.
  // Sitemap is anonymous-public by definition — only boards whose view
  // tier is 'anonymous' belong here. Stricter tiers require auth and
  // should not be discoverable via Google.
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
        columns: { slug: true, access: true, deletedAt: true },
      },
    },
  })

  for (const post of publicPosts) {
    if (post.board?.slug && post.board.access?.view === 'anonymous' && !post.board.deletedAt) {
      urls.push({
        loc: `${baseUrl}/b/${post.board.slug}/posts/${post.id}`,
        lastmod: toIsoDateOnly(post.updatedAt),
      })
    }
  }

  return urls
}
