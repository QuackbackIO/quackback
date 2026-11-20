import { createFileRoute } from '@tanstack/react-router'
import { escapeHtmlAttr, truncate } from '@/lib/shared/utils'

export const Route = createFileRoute('/status/feed')({
  server: {
    handlers: {
      /**
       * GET /status/feed
       * Returns an RSS 2.0 feed of the status page: one item per update of
       * open incidents, scheduled and in-progress maintenance, and recently
       * resolved items, newest first. Same XML builder and "denied caller
       * still gets a valid, empty feed" shape as `routes/changelog/feed.ts`.
       */
      GET: async () => {
        const [
          { getSectionOrigins },
          { sectionUrl },
          { getSettingsBrandingData },
          { listStatusFeedFn },
          labels,
        ] = await Promise.all([
          import('@/lib/server/domains/settings/section-links'),
          import('@/lib/shared/section-links'),
          import('@/lib/server/settings-utils'),
          import('@/lib/server/functions/status'),
          import('@/lib/server/domains/status/status.labels'),
        ])

        // On the status page's own host once it has one, so a reader never
        // leans on the redirect from the primary domain.
        const origins = await getSectionOrigins()
        const baseUrl = origins.status
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
          link: sectionUrl('status', '/status', origins),
          feedUrl: `${baseUrl}/status/feed`,
          entries: pickFeedEntries(items.map((item) => toFeedEntries(item, baseUrl, labels))),
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
  resolvedAt: string | null
  affectedComponents: Array<{ name: string }>
  updates: Array<{ id: string; status: string; body: string; createdAt: string }>
  /** When the title, window or services were last edited without an update. */
  detailsEditedAt: string | null
}

interface FeedEntry {
  title: string
  content: string
  publishedAt: Date
  link: string
  /** Opaque id; the entry's link doubles as a permalink guid when absent. */
  guid?: string
}

/** The entries one incident or window contributes, and whether it is still open. */
interface FeedEntryGroup {
  open: boolean
  entries: FeedEntry[]
}

/** The most items the feed carries (more only if more incidents are open). */
const FEED_ITEM_LIMIT = 50

/**
 * One feed item per update, so every update reaches a reader as its own item
 * even when several land between two polls. Each names the incident and the
 * status that update set, and carries the window and services as they are
 * now.
 *
 * An edit that posts no update (a reschedule, a new title, other services)
 * and comes after the latest update adds one more item, identified by the
 * edit's time: a reader that already read that update still learns of the
 * change. An edit before it is already in the update's item. Only the latest
 * edit has an item, so a run of edits adds one item per state a reader polls,
 * and the update items never change identity.
 */
function toFeedEntries(
  item: FeedItem,
  baseUrl: string,
  labels: { STATUS_LIFECYCLE_LABELS: Record<string, string> }
): FeedEntryGroup {
  const label = (status: string) => labels.STATUS_LIFECYCLE_LABELS[status] ?? status
  const link = `${baseUrl}/status/${item.id}`
  const titleFor = (status: string) =>
    `${item.kind === 'maintenance' ? 'Maintenance: ' : ''}${item.title} (${label(status)})`

  const context: string[] = []
  if (item.kind === 'maintenance' && item.scheduledStartAt) {
    const start = formatUtc(item.scheduledStartAt)
    context.push(
      item.scheduledEndAt
        ? `Window: ${start} to ${formatUtc(item.scheduledEndAt)}`
        : `Starts: ${start}`
    )
  }
  if (item.affectedComponents.length > 0) {
    context.push(`Affected: ${item.affectedComponents.map((c) => c.name).join(', ')}`)
  }

  const entries: FeedEntry[] = item.updates.map((update) => ({
    title: titleFor(update.status),
    // Only the body is shortened, so the window and services always follow.
    content: [truncate(update.body, 500), ...context].join(' · '),
    publishedAt: new Date(update.createdAt),
    link,
    guid: `${link}#${update.id}`,
  }))

  const editedAt = item.detailsEditedAt ? new Date(item.detailsEditedAt) : null
  const latestUpdateAt = Math.max(...entries.map((entry) => entry.publishedAt.getTime()))
  if (editedAt && editedAt.getTime() > latestUpdateAt) {
    entries.push({
      title: titleFor(item.status),
      content: ['Details updated', ...context].join(' · '),
      publishedAt: editedAt,
      link,
      guid: `${link}#edited-${editedAt.getTime()}`,
    })
  }
  return { open: item.resolvedAt === null, entries }
}

/**
 * The newest entries, newest first, up to {@link FEED_ITEM_LIMIT}. The newest
 * entry of every open incident or window always stays, in place of an older
 * one, so what is happening now is never pushed out by a busy history.
 */
function pickFeedEntries(groups: FeedEntryGroup[]): FeedEntry[] {
  const newestFirst = (a: FeedEntry, b: FeedEntry) =>
    b.publishedAt.getTime() - a.publishedAt.getTime()
  const kept = new Set<FeedEntry>()
  for (const group of groups) {
    if (group.open && group.entries.length > 0) kept.add([...group.entries].sort(newestFirst)[0])
  }
  const rest = groups
    .flatMap((group) => group.entries)
    .filter((entry) => !kept.has(entry))
    .sort(newestFirst)
  for (const entry of rest.slice(0, Math.max(0, FEED_ITEM_LIMIT - kept.size))) kept.add(entry)
  return [...kept].sort(newestFirst)
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

  // A reader renders a description as HTML. Bodies are plain text, so they
  // are HTML-escaped (text that looks like a tag stays text) with their line
  // breaks kept, then XML-escaped like every other value.
  const toDescriptionHtml = (text: string): string => escapeHtmlAttr(text).replace(/\r?\n/g, '<br>')

  const items = entries
    .map((entry) => {
      return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.link)}</link>
      ${
        entry.guid
          ? `<guid isPermaLink="false">${escapeXml(entry.guid)}</guid>`
          : `<guid isPermaLink="true">${escapeXml(entry.link)}</guid>`
      }
      <description>${escapeXml(toDescriptionHtml(entry.content))}</description>
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
