import { createFileRoute } from '@tanstack/react-router'
import { notTestPrincipal } from '@/lib/server/test-data'
import { publicWorkspaceCacheHeaders } from '@/lib/server/workspaces/http-cache'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [
          { renderSitemap },
          { getSectionOrigins },
          { portalSitemapSections, buildPortalSitemapUrls },
          { sectionServedAt },
          { requestWorkspaceHost },
        ] = await Promise.all([
          import('@/lib/server/sitemap'),
          import('@/lib/server/domains/settings/section-links'),
          import('@/lib/shared/portal-sitemap'),
          import('@/lib/shared/section-links'),
          import('@/lib/server/workspaces/saas-edge-host'),
        ])

        const url = new URL(request.url)
        const pageParam = url.searchParams.get('page')
        const page = pageParam ? parseInt(pageParam, 10) : null

        // Each host lists its own pages: a section on its own host
        // (news.acme.com for the changelog) only that section, the primary
        // domain the sections it serves itself.
        const origins = await getSectionOrigins()
        const host = requestWorkspaceHost(request)
        const hostSection = sectionServedAt(host, origins)
        const baseUrl = hostSection ? origins[hostSection] : origins.primary

        // Private portals must not expose URLs to search engines.
        const { getWorkspaceSettings } =
          await import('@/lib/server/domains/settings/settings.service')
        const workspace = await getWorkspaceSettings()
        if (workspace?.portalConfig?.access?.visibility === 'private') {
          return new Response(renderSitemap([], baseUrl, null) ?? '', {
            headers: {
              'Content-Type': 'application/xml; charset=utf-8',
              ...publicWorkspaceCacheHeaders(3600),
            },
          })
        }

        const allUrls = buildPortalSitemapUrls({
          origins,
          sections: portalSitemapSections(host, origins),
          ...(await collectContent()),
        })

        const xml = renderSitemap(allUrls, baseUrl, isNaN(page as number) ? null : page)

        if (!xml) {
          return new Response('Not Found', { status: 404 })
        }

        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            // The sitemap is per-workspace content on a path every workspace shares.
            ...publicWorkspaceCacheHeaders(3600),
          },
        })
      },
    },
  },
})

/** The public changelog entries and posts the sitemap may list. */
async function collectContent() {
  const [
    { db, changelogEntries, and, desc, eq, sql },
    { publicChangelogConditions },
    { getFeatureFlags },
  ] = await Promise.all([
    import('@/lib/server/db'),
    import('@/lib/server/domains/changelog/changelog.public'),
    import('@/lib/server/domains/settings/settings.service'),
  ])

  const effectiveDisplayDate = sql<Date>`coalesce(${changelogEntries.displayDate}, ${changelogEntries.publishedAt})`
  const flags = await getFeatureFlags()

  const entries = flags.changelog
    ? await db
        .select({ id: changelogEntries.id, updatedAt: changelogEntries.updatedAt })
        .from(changelogEntries)
        .where(and(...publicChangelogConditions(new Date())))
        .orderBy(desc(effectiveDisplayDate))
    : []

  // Published, non-merged posts on public, non-deleted boards.
  // Sitemap is anonymous-public by definition — only boards whose view
  // tier is 'anonymous' belong here. Stricter tiers require auth and
  // should not be discoverable via Google.
  const publicPosts = flags.feedback
    ? await db.query.posts.findMany({
        where: (table, { and, isNull }) =>
          and(
            isNull(table.deletedAt),
            eq(table.moderationState, 'published'),
            isNull(table.canonicalPostId),
            notTestPrincipal(table.principalId)
          ),
        columns: { id: true, updatedAt: true },
        with: {
          board: {
            columns: { slug: true, access: true, deletedAt: true },
          },
        },
      })
    : []

  return {
    flags: { feedback: flags.feedback, changelog: flags.changelog },
    changelogEntries: entries,
    posts: publicPosts.flatMap((post) =>
      post.board?.slug && post.board.access?.view === 'anonymous' && !post.board.deletedAt
        ? [{ id: post.id, boardSlug: post.board.slug, updatedAt: post.updatedAt }]
        : []
    ),
  }
}
