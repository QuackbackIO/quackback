import { createFileRoute } from '@tanstack/react-router'
import { stripHtml, truncate } from '@/lib/shared/utils'

export const Route = createFileRoute('/status/feed')({
  server: {
    handlers: {
      /**
       * GET /status/feed
       * Returns an RSS 2.0 feed of recent (resolved) status incidents.
       * Mirrors `routes/changelog/feed.ts` exactly: same XML builder, same
       * "denied caller still gets a valid, empty feed" shape.
       */
      GET: async () => {
        const [{ config }, { getSettingsBrandingData }, { listStatusHistoryFn }] =
          await Promise.all([
            import('@/lib/server/config'),
            import('@/lib/server/settings-utils'),
            import('@/lib/server/functions/status'),
          ])

        const baseUrl = config.baseUrl
        const branding = await getSettingsBrandingData()
        const siteName = branding?.name || 'Status'

        // `listStatusHistoryFn` independently composes every status-page
        // gate (portal access, `statusSettings.enabled`, the `statusPage`
        // feature flag, and the audience ladder — see
        // `resolveStatusPageGate` in `lib/server/functions/status.ts`) and
        // returns an empty result rather than throwing when denied. A
        // private/disabled/gated-out status page therefore still yields a
        // valid, empty RSS document here — same contract as the changelog
        // feed and sitemap.xml, never a data leak.
        const history = await listStatusHistoryFn({ data: { limit: 50 } })

        // Same per-caller-portal-access reasoning as the changelog feed:
        // a granted caller must not seed a shared CDN cache that a
        // subsequently-denied caller would then receive.
        const cacheControl = 'private, max-age=300'

        const rssXml = buildRssFeed({
          title: `${siteName} Status`,
          description: `Recent incidents and maintenance for ${siteName}`,
          link: `${baseUrl}/status`,
          feedUrl: `${baseUrl}/status/feed`,
          entries: history.items.map((incident) => {
            const latestUpdate = incident.updates[incident.updates.length - 1]
            return {
              title: incident.title,
              content: latestUpdate?.body ?? '',
              publishedAt: new Date(incident.resolvedAt ?? incident.startedAt),
              link: `${baseUrl}/status/${incident.id}`,
            }
          }),
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
