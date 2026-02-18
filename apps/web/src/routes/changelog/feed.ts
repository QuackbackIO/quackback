import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'
import { db, changelogEntries, desc, isNotNull, lte } from '@/lib/server/db'
import { getSettingsBrandingData } from '@/lib/server/settings-utils'
import { stripHtml } from '@/lib/shared/utils'

export const Route = createFileRoute('/changelog/feed')({
  server: {
    handlers: {
      /**
       * GET /changelog/feed
       * Returns RSS 2.0 feed of published changelog entries
       */
      GET: async () => {
        const baseUrl = config.baseUrl

        // Get workspace branding for feed title
        const branding = await getSettingsBrandingData()
        const siteName = branding?.name || 'Changelog'

        // Fetch published changelog entries (limit to last 50)
        const entries = await db.query.changelogEntries.findMany({
          where: (table, { and }) =>
            and(isNotNull(table.publishedAt), lte(table.publishedAt, new Date())),
          orderBy: [desc(changelogEntries.publishedAt)],
          limit: 50,
        })

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
            publishedAt: entry.publishedAt!,
            link: `${baseUrl}/changelog/${entry.id}`,
          })),
        })

        return new Response(rssXml, {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
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
      const plainContent = stripHtml(entry.content)
      const truncatedContent =
        plainContent.length > 500 ? plainContent.slice(0, 500) + '...' : plainContent

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
