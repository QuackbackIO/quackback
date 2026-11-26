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
 * The reply preview the SDK shows above the closed launcher, sent to the host
 * as `quackback:reply-preview`, and the tab title flash, sent as
 * `quackback:title-alert`. The frame holds the catalogue, so the card's words
 * travel with the replies. Both carry message text or a teammate's name, so
 * they go out only when the workspace turns them on.
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
}

export interface ReplyPreviewPayload {
  conversationId: string
  author: { name: string; firstName: string; avatarUrl: string | null }
  teamName: string
  messages: Array<{ id: string; text: string; createdAt: string }>
  count: number
  full: boolean
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
  full: boolean
): ReplyPreviewPayload {
  const names = namesOf(data)
  const header =
    names.full && names.team
      ? intl.formatMessage(
          { id: 'widget.replyPreview.header', defaultMessage: '{name} from {team}' },
          { name: names.first, team: names.team }
        )
      : names.first
  const announce = intl.formatMessage(
    { id: 'widget.replyPreview.announce', defaultMessage: 'New reply from {name}' },
    { name: names.first }
  )
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
    count: data.count,
    full,
    strings: {
      header,
      replyTo: intl.formatMessage(
        { id: 'widget.replyPreview.replyTo', defaultMessage: 'Reply to {name}…' },
        { name: names.first }
      ),
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

export function buildTitleAlert(intl: IntlShape, data: UnreadReplies): string {
  return intl.formatMessage(
    { id: 'widget.replyPreview.replied', defaultMessage: '{name} replied' },
    { name: namesOf(data).first }
  )
}

/**
 * The visitor's newest unread replies, read while `enabled` and something is
 * unread. Re-read whenever the unread count changes; the previous answer
 * stays while the next loads, within one widget session.
 */
export function useUnreadReplies(
  enabled: boolean,
  unread: number
): { ready: boolean; data: UnreadReplies | null } {
  const { sessionVersion } = useWidgetAuth()
  const active = enabled && unread > 0
  const { data } = useQuery({
    queryKey: [...conversationKeys.widgetReplyPreview(sessionVersion), unread] as const,
    queryFn: () => widgetGetReplyPreviewFn({ headers: getWidgetAuthHeaders() }),
    enabled: active,
    // Keyed on the count, so a count seen before must not serve old replies.
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

/** Send `{ type, [field]: value }` to the host when the value changes, or
 *  the session does; once off after a send, send a null value once. */
function useSendOnChange(
  type: string,
  field: string,
  enabled: boolean,
  ready: boolean,
  session: number,
  value: unknown
): void {
  // What went out last, as "<session>\n<value JSON>".
  const lastSent = useRef<string | null>(null)
  let key: string | null = null
  if (enabled) {
    if (ready) key = `${session}\n${JSON.stringify(value)}`
  } else if (lastSent.current !== null && !lastSent.current.endsWith('\nnull')) {
    // Off after something went out: the host must drop it.
    key = `${lastSent.current.slice(0, lastSent.current.indexOf('\n'))}\nnull`
  }
  useEffect(() => {
    if (key === null || key === lastSent.current) return
    lastSent.current = key
    sendToHost({ type, [field]: JSON.parse(key.slice(key.indexOf('\n') + 1)) })
  }, [type, field, key])
}

/**
 * Tell the host about the newest unread replies whenever they change, or
 * null once nothing is unread. The card goes out only while `replyAlerts`
 * is not 'badge', the tab title text only while `titleAlerts` is on. A new
 * widget session sends again, even when the payload is the same: the host
 * drops the previous visitor's card and waits for this one.
 */
export function useReplyPreviewAnnouncement(
  settings: { replyAlerts: ReplyAlerts; titleAlerts: boolean },
  state: { ready: boolean; data: UnreadReplies | null; session?: number }
): void {
  const intl = useIntl()
  const session = state.session ?? 0
  const showCard = settings.replyAlerts !== 'badge'
  const preview =
    showCard && state.data
      ? buildReplyPreview(intl, state.data, settings.replyAlerts === 'full')
      : null
  const title = settings.titleAlerts && state.data ? buildTitleAlert(intl, state.data) : null
  useSendOnChange(
    'quackback:reply-preview',
    'replyPreview',
    showCard,
    state.ready,
    session,
    preview
  )
  useSendOnChange(
    'quackback:title-alert',
    'text',
    settings.titleAlerts,
    state.ready,
    session,
    title
  )
}
