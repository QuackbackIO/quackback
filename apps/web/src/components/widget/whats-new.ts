import { useEffect, useRef } from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import { contentPreview } from '@/lib/shared/utils/string'
import { sendToHost } from '@/lib/client/widget-bridge'

/**
 * The "What's new" card the SDK shows above the closed launcher: the newest
 * unread changelog entry, sent to the host as `quackback:whats-new`. The
 * frame holds the catalogue, so the card's words travel with the entry.
 */

/** Roughly two lines of the card's excerpt. */
const EXCERPT_LENGTH = 120

export interface WhatsNewEntry {
  id: string
  title: string
  content: string
  publishedAt: string
}

export interface WhatsNewPayload {
  count: number
  entry: { id: string; title: string; excerpt: string; publishedAt: string; date: string }
  strings: { pill: string; action: string; dismiss: string; label: string }
}

/**
 * Cut plain text to `max` characters at the last word break, with an
 * ellipsis. Text without spaces (Thai, Chinese) is cut at `max`.
 */
export function excerptAtWord(text: string, max: number): string {
  const plain = text.trim()
  if (plain.length <= max) return plain
  let cut = plain.slice(0, max)
  const space = cut.lastIndexOf(' ')
  if (space > max / 2) cut = cut.slice(0, space)
  return `${cut.replace(/[\s.,;:!?]+$/, '')}…`
}

export function buildWhatsNew(
  intl: IntlShape,
  count: number,
  entry: WhatsNewEntry
): WhatsNewPayload {
  return {
    count,
    entry: {
      id: entry.id,
      title: entry.title,
      excerpt: excerptAtWord(contentPreview(entry.content), EXCERPT_LENGTH),
      publishedAt: entry.publishedAt,
      date: intl.formatDate(entry.publishedAt, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    },
    strings: {
      pill: intl.formatMessage(
        {
          id: 'widget.whatsNew.count',
          defaultMessage: '{count, plural, one {# new update} other {# new updates}}',
        },
        { count }
      ),
      action: intl.formatMessage({
        id: 'widget.whatsNew.action',
        defaultMessage: "See what's new",
      }),
      dismiss: intl.formatMessage({ id: 'widget.whatsNew.dismiss', defaultMessage: 'Dismiss' }),
      label: intl.formatMessage({
        id: 'widget.launcher.changelog.heading',
        defaultMessage: "What's new",
      }),
    },
  }
}

/**
 * Tell the host about the newest unread entry whenever it changes, or null
 * once nothing is unread. Sends nothing while `enabled` is off (the workspace
 * setting) or before the changelog has loaded, so a reload never flickers
 * the card away.
 */
export function useWhatsNewAnnouncement(
  enabled: boolean,
  state: { ready: boolean; count: number; newest: WhatsNewEntry | null }
): void {
  const intl = useIntl()
  const lastSent = useRef<string | null>(null)
  const payload =
    enabled && state.ready && state.count > 0 && state.newest
      ? buildWhatsNew(intl, state.count, state.newest)
      : null
  const key = enabled && state.ready ? JSON.stringify(payload) : null
  useEffect(() => {
    if (key === null || key === lastSent.current) return
    lastSent.current = key
    sendToHost({ type: 'quackback:whats-new', whatsNew: JSON.parse(key) })
  }, [key])
}
