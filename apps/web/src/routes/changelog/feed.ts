import { createFileRoute } from '@tanstack/react-router'
import { stripHtml, truncate } from '@/lib/shared/utils'

export const Route = createFileRoute('/changelog/feed')({
  server: {
    handlers: {
      /**
       * GET /changelog/feed
       * Returns RSS 2.0 feed of published changelog entries
       */
      GET: async () => {
        const [
          { config },
          { db, changelogEntries, and, desc, sql },
          { publicChangelogConditions },
          { getSettingsBrandingData },
          { resolvePortalAccessForRequest },
          { isChangelogAudienceGranted },
          { getOptionalAuth, policyActorFromAuth },
        ] = await Promise.all([
          import('@/lib/server/config'),
          import('@/lib/server/db'),
          import('@/lib/server/domains/changelog/changelog.public'),
          import('@/lib/server/settings-utils'),
          import('@/lib/server/functions/portal-access'),
          import('@/lib/server/domains/changelog/changelog.audience'),
          import('@/lib/server/functions/auth-helpers'),
        ])

        const effectiveDisplayDate = sql<Date>`coalesce(${changelogEntries.displayDate}, ${changelogEntries.publishedAt})`

        const baseUrl = config.baseUrl

        // Get workspace branding for feed title
        const branding = await getSettingsBrandingData()
        const siteName = branding?.name || 'Changelog'

        // Private portals must not expose changelog content via the RSS feed.
        // Mirror sitemap.xml: a denied caller gets a valid but empty feed.
        const access = await resolvePortalAccessForRequest()

        // Changelog audience gate (Settings > Changelog > Visibility):
        // 'authenticated' hides the feed from anonymous fetchers too.
        const actor = access.granted
          ? await policyActorFromAuth(await getOptionalAuth())
          : null
        const audienceGranted = actor ? await isChangelogAudienceGranted(actor) : false

        const entries =
          access.granted && audienceGranted
            ? await db
                .select()
                .from(changelogEntries)
                .where(and(...publicChangelogConditions(new Date())))
                .orderBy(desc(effectiveDisplayDate))
                .limit(50)
            : []

        // Per-caller portal-access decisions can't share a public CDN
        // cache: a granted caller would seed the cache with content that
        // every subsequent denied caller would then receive. Use
        // `private` to keep the response per-browser, and `Vary: Cookie`
        // so any cookie-aware intermediary keys correctly. Public
        // portals match `granted=true` for everyone, so the practical
        // cost (no shared CDN cache) is small — and the alternative is
        // a real data leak.
        const cacheControl = 'private, max-age=300'

        // Build RSS XML
        const rssXml = buildRssFeed({
          title: `${siteName} Changelog`,
          description: `Latest updates and releases from ${siteName}`,
          link: `${baseUrl}/changelog`,
          feedUrl: `${baseUrl}/changelog/feed`,
          entries: entries.map((entry) => ({
            id: entry.id,
            title: entry.title,
            content: entry.content,
            publishedAt: entry.displayDate ?? entry.publishedAt!,
            link: `${baseUrl}/changelog/${entry.id}`,
          })),
        })

        return new Response(rssXml, {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': cacheControl,
            Vary: 'Cookie',
          },
        })
      },
    },
  },
})

interface RssFeedOptions {
  title: string
  description: string
  link: string
  feedUrl: string
  entries: Array<{
    id: string
    title: string
    content: string
    publishedAt: Date
    link: string
  }>
}

function buildRssFeed(options: RssFeedOptions): string {
  const { title, description, link, feedUrl, entries } = options

  const escapeXml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  const formatRfc822Date = (date: Date): string => {
    return date.toUTCString()
  }

  const items = entries
    .map((entry) => {
      // Strip HTML for description, keep it short
      const truncatedContent = truncate(stripHtml(entry.content), 500)

      return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.link)}</link>
      <guid isPermaLink="true">${escapeXml(entry.link)}</guid>
      <description>${escapeXml(truncatedContent)}</description>
      <pubDate>${formatRfc822Date(entry.publishedAt)}</pubDate>
    </item>`
    })
    .join('\n')

  const lastBuildDate =
    entries.length > 0 ? formatRfc822Date(entries[0].publishedAt) : formatRfc822Date(new Date())

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <description>${escapeXml(description)}</description>
    <link>${escapeXml(link)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <language>en-us</language>
${items}
  </channel>
</rss>`
}
