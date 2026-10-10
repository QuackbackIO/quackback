import { createFileRoute } from '@tanstack/react-router'
import { truncate } from '@/lib/shared/utils'

export const Route = createFileRoute('/status/feed')({
  server: {
    handlers: {
      /**
       * GET /status/feed
       * Returns an RSS 2.0 feed of the status page: open incidents,
       * scheduled and in-progress maintenance, and recently resolved items,
       * newest activity first. Same XML builder and "denied caller still
       * gets a valid, empty feed" shape as `routes/changelog/feed.ts`.
       */
      GET: async () => {
        const [{ config }, { getSettingsBrandingData }, { listStatusFeedFn }, labels] =
          await Promise.all([
            import('@/lib/server/config'),
            import('@/lib/server/settings-utils'),
            import('@/lib/server/functions/status'),
            import('@/lib/server/domains/status/status.labels'),
          ])

        const baseUrl = config.baseUrl
        const branding = await getSettingsBrandingData()
        const siteName = branding?.name || 'Status'

        // `listStatusFeedFn` independently composes every status-page
        // gate (portal access, `isStatusPagePublished`, and the audience
        // ladder — see `resolveStatusPageGate` in
        // `lib/server/functions/status.ts`) and returns an empty list
        // rather than throwing when denied. A private/disabled/gated-out
        // status page therefore still yields a valid, empty RSS document
        // here — same contract as the changelog feed and sitemap.xml,
        // never a data leak.
        const items = await listStatusFeedFn({ data: { limit: 50 } })

        // Same per-caller-portal-access reasoning as the changelog feed:
        // a granted caller must not seed a shared CDN cache that a
        // subsequently-denied caller would then receive.
        const cacheControl = 'private, max-age=300'

        const rssXml = buildRssFeed({
          title: `${siteName} Status`,
          description: `Incidents and maintenance for ${siteName}`,
          link: `${baseUrl}/status`,
          feedUrl: `${baseUrl}/status/feed`,
          entries: items.map((item) => toFeedEntry(item, baseUrl, labels)),
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

interface FeedItem {
  id: string
  kind: 'incident' | 'maintenance'
  title: string
  status: string
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  affectedComponents: Array<{ name: string }>
  updates: Array<{ id: string; status: string; body: string }>
  lastActivityAt: string
}

interface FeedEntry {
  title: string
  content: string
  publishedAt: Date
  link: string
  /** Opaque id; the entry's link doubles as a permalink guid when absent. */
  guid?: string
}

/**
 * One feed item per incident or maintenance window, carrying its current
 * state. The guid names the latest update, so each new update reaches a
 * reader as a new item rather than a silent edit to one it already read.
 */
function toFeedEntry(
  item: FeedItem,
  baseUrl: string,
  labels: { STATUS_LIFECYCLE_LABELS: Record<string, string> }
): FeedEntry {
  const label = (status: string) => labels.STATUS_LIFECYCLE_LABELS[status] ?? status
  const link = `${baseUrl}/status/${item.id}`
  const latest = item.updates[item.updates.length - 1]

  const details: string[] = []
  if (latest) details.push(`${label(latest.status)}: ${latest.body}`)
  if (item.kind === 'maintenance' && item.scheduledStartAt) {
    const start = formatUtc(item.scheduledStartAt)
    details.push(
      item.scheduledEndAt
        ? `Window: ${start} to ${formatUtc(item.scheduledEndAt)}`
        : `Starts: ${start}`
    )
  }
  if (item.affectedComponents.length > 0) {
    details.push(`Affected: ${item.affectedComponents.map((c) => c.name).join(', ')}`)
  }

  return {
    title: `${item.kind === 'maintenance' ? 'Maintenance: ' : ''}${item.title} (${label(item.status)})`,
    content: details.join(' · '),
    publishedAt: new Date(item.lastActivityAt),
    link,
    guid: latest ? `${link}#${latest.id}` : undefined,
  }
}

/** ISO string → "October 12, 2026 at 02:00 UTC" (the page and emails state UTC too). */
function formatUtc(iso: string): string {
  const formatted = new Date(iso).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  })
  return `${formatted} UTC`
}

interface RssFeedOptions {
  title: string
  description: string
  link: string
  feedUrl: string
  entries: FeedEntry[]
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
      // Status update bodies are plain text: escaping is all they need, and
      // stripping would drop anything an admin typed that looks like a tag.
      const truncatedContent = truncate(entry.content, 500)

      return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.link)}</link>
      ${
        entry.guid
          ? `<guid isPermaLink="false">${escapeXml(entry.guid)}</guid>`
          : `<guid isPermaLink="true">${escapeXml(entry.link)}</guid>`
      }
      <description>${escapeXml(truncatedContent)}</description>
      <pubDate>${formatRfc822Date(entry.publishedAt)}</pubDate>
    </item>`
    })
    .join('\n')

  const lastBuildDate =
    entries.length > 0 ? formatRfc822Date(entries[0].publishedAt) : formatRfc822Date(new Date())

  // `<language>` stays en-us: a workspace has no content-language setting to
  // take it from (the portal picks each visitor's language from their
  // browser, and the help center's default locale is fixed to English).

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
