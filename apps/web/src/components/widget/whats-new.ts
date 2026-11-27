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
 * ellipsis. Text without spaces (Thai, Chinese) is cut at `max`. Counts code
 * points, so an emoji is never split.
 */
export function excerptAtWord(text: string, max: number): string {
  const chars = Array.from(text.trim())
  if (chars.length <= max) return chars.join('')
  let cut = chars.slice(0, max)
  const space = cut.lastIndexOf(' ')
  if (space > max / 2) cut = cut.slice(0, space)
  return `${cut.join('').replace(/[\s.,;:!?]+$/, '')}…`
}

/**
 * `more`: the loaded entries are all unread and more exist, so `count` is a
 * lower bound and the pill says so ("10+ new updates").
 */
export function buildWhatsNew(
  intl: IntlShape,
  count: number,
  entry: WhatsNewEntry,
  more = false
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
      pill: more
        ? intl.formatMessage(
            {
              id: 'widget.whatsNew.countAtLeast',
              defaultMessage: '{count, plural, one {#+ new update} other {#+ new updates}}',
            },
            { count }
          )
        : intl.formatMessage(
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
 * the card away. Turning off after a card was sent clears it once. A new
 * widget session (the visitor signed in or out) sends again once its
 * changelog loads, even when the card is the same: the host drops the
 * previous visitor's card and waits for this one.
 */
export function useWhatsNewAnnouncement(
  enabled: boolean,
  state: {
    ready: boolean
    count: number
    newest: WhatsNewEntry | null
    /** The widget session the changelog was loaded for. */
    session?: number
    /** More unread entries exist than are loaded. */
    more?: boolean
  }
): void {
  const intl = useIntl()
  // What went out last, as "<session>\n<payload JSON>".
  const lastSent = useRef<string | null>(null)
  const payload =
    enabled && state.ready && state.count > 0 && state.newest
      ? buildWhatsNew(intl, state.count, state.newest, state.more)
      : null
  const session = state.session ?? 0
  let key: string | null = null
  if (enabled) {
    if (state.ready) key = `${session}\n${JSON.stringify(payload)}`
  } else if (lastSent.current !== null && !lastSent.current.endsWith('\nnull')) {
    // Off after a card went out: the host must drop it.
    key = `${lastSent.current.slice(0, lastSent.current.indexOf('\n'))}\nnull`
  }
  useEffect(() => {
    if (key === null || key === lastSent.current) return
    lastSent.current = key
    sendToHost({
      type: 'quackback:whats-new',
      whatsNew: JSON.parse(key.slice(key.indexOf('\n') + 1)),
    })
  }, [key])
}
