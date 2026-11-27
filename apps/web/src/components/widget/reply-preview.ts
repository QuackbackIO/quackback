import { useEffect, useRef } from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { firstNameOf } from '@/lib/shared/conversation/personalize'
import { sendToHost } from '@/lib/client/widget-bridge'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { widgetGetReplyPreviewFn } from '@/lib/server/functions/widget/conversation'
import { useWidgetAuth } from './widget-auth-provider'
import { excerptAtWord } from './whats-new'

/**
 * The newest unread replies, sent to the host as `quackback:reply-preview`.
 * The SDK fires its `message` event from them whatever the workspace shows,
 * renders the card above the closed launcher only when `card` is set, and
 * flashes `title` in the tab title when there is one. The frame holds the
 * catalogue, so the card's words travel with the replies.
 */

export type ReplyAlerts = 'badge' | 'preview' | 'full'

/** Roughly four lines of a bubble. */
const PREVIEW_LENGTH = 180

/** The newest unread replies, as the widget read returns them. */
export interface UnreadReplies {
  conversationId: string
  author: { name: string | null; avatarUrl: string | null }
  teamName: string | null
  count: number
  messages: Array<{ id: string; text: string; createdAt: string }>
  /** Every conversation's newest unread replies, for the host's message event. */
  recent: Array<{
    id: string
    conversationId: string
    author: { name: string | null; avatarUrl: string | null }
    text: string
  }>
}

export interface ReplyPreviewPayload {
  conversationId: string
  author: { name: string; firstName: string; avatarUrl: string | null }
  teamName: string
  messages: Array<{ id: string; text: string; createdAt: string }>
  /** Every new unread reply across the visitor's conversations, oldest first,
   *  each with its author: the SDK reports each one once. */
  recent: Array<{
    id: string
    conversationId: string
    author: { name: string; avatarUrl: string | null }
    text: string
  }>
  count: number
  /** Show the card above the launcher; off with the badge only. */
  card: boolean
  full: boolean
  /** The tab title flash, e.g. "Alex replied", or null when that is off. */
  title: string | null
  strings: {
    header: string
    replyTo: string
    newReplies: string
    dismiss: string
    label: string
    announce: string
  }
}

/** How the reply is named: the author's first name, else the team. */
function namesOf(data: UnreadReplies): { full: string; first: string; team: string } {
  const full = data.author.name?.trim() ?? ''
  const team = data.teamName?.trim() ?? ''
  return { full, first: firstNameOf(full) ?? team, team }
}

/** An absolute avatar URL, so the host page loads it from this instance. */
function absoluteUrl(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url, window.location.origin).href
  } catch {
    return null
  }
}

export function buildReplyPreview(
  intl: IntlShape,
  data: UnreadReplies,
  settings: { replyAlerts: ReplyAlerts; titleAlerts: boolean }
): ReplyPreviewPayload {
  const full = settings.replyAlerts === 'full'
  const names = namesOf(data)
  // With neither a name nor a team, the card still has words: "New reply".
  const newReply = intl.formatMessage({
    id: 'widget.replyPreview.newReply',
    defaultMessage: 'New reply',
  })
  const header = !names.first
    ? newReply
    : names.full && names.team
      ? intl.formatMessage(
          { id: 'widget.replyPreview.header', defaultMessage: '{name} from {team}' },
          { name: names.first, team: names.team }
        )
      : names.first
  const announce = names.first
    ? intl.formatMessage(
        { id: 'widget.replyPreview.announce', defaultMessage: 'New reply from {name}' },
        { name: names.first }
      )
    : newReply
  const attachment = intl.formatMessage({
    id: 'widget.replyPreview.attachment',
    defaultMessage: 'Sent an attachment',
  })
  return {
    conversationId: data.conversationId,
    author: {
      name: names.full,
      firstName: names.first,
      avatarUrl: absoluteUrl(data.author.avatarUrl),
    },
    teamName: names.team,
    messages: data.messages.slice(-3).map((m) => ({
      id: m.id,
      text: !m.text ? attachment : full ? m.text : excerptAtWord(m.text, PREVIEW_LENGTH),
      createdAt: m.createdAt,
    })),
    recent: data.recent.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      author: {
        name: m.author.name?.trim() || names.team,
        avatarUrl: absoluteUrl(m.author.avatarUrl),
      },
      text: m.text || attachment,
    })),
    count: data.count,
    card: settings.replyAlerts !== 'badge',
    full,
    title: !settings.titleAlerts
      ? null
      : names.first
        ? intl.formatMessage(
            { id: 'widget.replyPreview.replied', defaultMessage: '{name} replied' },
            { name: names.first }
          )
        : newReply,
    strings: {
      header,
      replyTo: names.first
        ? intl.formatMessage(
            { id: 'widget.replyPreview.replyTo', defaultMessage: 'Reply to {name}…' },
            { name: names.first }
          )
        : intl.formatMessage({
            id: 'widget.replyPreview.replyGeneric',
            defaultMessage: 'Write a reply…',
          }),
      newReplies: intl.formatMessage(
        {
          id: 'widget.replyPreview.newReplies',
          defaultMessage: '{count, plural, one {# new reply} other {# new replies}}',
        },
        { count: data.count }
      ),
      dismiss: intl.formatMessage({ id: 'widget.whatsNew.dismiss', defaultMessage: 'Dismiss' }),
      label: announce,
      announce,
    },
  }
}

/**
 * The visitor's newest unread replies, read while `enabled` and something is
 * unread. Read again when the total or the newest unread reply changes, not
 * on every poll: a read in one conversation and a new reply in another can
 * leave the total as it was, but never the newest reply. The previous
 * answer stays while the next loads, within one widget session.
 */
export function useUnreadReplies(
  enabled: boolean,
  unread: number,
  newestReplyId: string | null
): { ready: boolean; data: UnreadReplies | null } {
  const { sessionVersion } = useWidgetAuth()
  const active = enabled && unread > 0
  const { data } = useQuery({
    queryKey: [
      ...conversationKeys.widgetReplyPreview(sessionVersion),
      unread,
      newestReplyId,
    ] as const,
    queryFn: () => widgetGetReplyPreviewFn({ headers: getWidgetAuthHeaders() }),
    enabled: active,
    // Keyed on the total and newest reply, so a pair seen before is read again.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // Keep the card while a newer read loads, never across a session change.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[2] === sessionVersion ? prev : undefined,
  })
  if (!active) return { ready: true, data: null }
  return { ready: data !== undefined, data: data ?? null }
}

/**
 * Tell the host about the newest unread replies whenever they change, or
 * null once nothing is unread, while `enabled` (the Messages tab shows).
 * Sent whatever the card setting: the host's `message` event relies on it.
 * A new widget session sends again, even when the payload is the same: the
 * host drops the previous visitor's replies and waits for this one. Turning
 * off after a send clears them once.
 */
export function useReplyPreviewAnnouncement(
  settings: { enabled: boolean; replyAlerts: ReplyAlerts; titleAlerts: boolean },
  state: { ready: boolean; data: UnreadReplies | null; session?: number }
): void {
  const intl = useIntl()
  const session = state.session ?? 0
  const preview =
    settings.enabled && state.data ? buildReplyPreview(intl, state.data, settings) : null
  // What went out last, as "<session>\n<payload JSON>".
  const lastSent = useRef<string | null>(null)
  let key: string | null = null
  if (settings.enabled) {
    if (state.ready) key = `${session}\n${JSON.stringify(preview)}`
  } else if (lastSent.current !== null && !lastSent.current.endsWith('\nnull')) {
    key = `${lastSent.current.slice(0, lastSent.current.indexOf('\n'))}\nnull`
  }
  useEffect(() => {
    if (key === null || key === lastSent.current) return
    lastSent.current = key
    sendToHost({
      type: 'quackback:reply-preview',
      replyPreview: JSON.parse(key.slice(key.indexOf('\n') + 1)),
    })
  }, [key])
}
