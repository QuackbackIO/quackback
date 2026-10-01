/**
 * The conversation-wide gallery an attachment card opens into: every file in
 * the loaded thread, in message order, so the viewer's arrow keys move
 * through the whole conversation rather than just the one message a card
 * lives on. `AttachmentList` reads this via `useConversationGallery` to find
 * where its own attachments sit in that flat order.
 *
 * Mounted once around the message list in both thread components
 * (`agent-conversation-thread.tsx`, `visitor-conversation-thread.tsx`) — never
 * around the composer, which has no business with this gallery.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import { toViewerFile, type ViewerFile } from './types'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'
import { sanitizeImageUrl } from '@/lib/shared/utils/sanitize'

/**
 * Defense-in-depth: never treat a javascript: (or other hostile) URL as a
 * file to render. `AttachmentList` filters a message's own attachments
 * through this before rendering cards; the gallery applies the exact same
 * filter before flattening attachments across the thread, so a card's local
 * index (computed over its own already-filtered attachments) always lands on
 * the same file here — an unsafe attachment ahead of a safe one in the raw
 * array would otherwise shift every index after it by one.
 */
export function isSafeAttachment(a: ConversationAttachment): boolean {
  if (a.contentType.startsWith('image/')) return sanitizeImageUrl(a.url).length > 0
  if (a.url.startsWith('/')) return true
  try {
    const proto = new URL(a.url).protocol
    return proto === 'https:' || proto === 'http:'
  } catch {
    return false
  }
}

/** The minimum a message needs to carry to contribute to the gallery. */
export interface GalleryMessage {
  id: string
  isInternal: boolean
  attachments: ConversationAttachment[]
  createdAt: string
  senderType: 'visitor' | 'agent' | 'system'
  isAssistant: boolean
  author: { displayName: string | null } | null
}

export interface ConversationGalleryApi {
  /** Every attachment in the thread, in message order. */
  files: ViewerFile[]
  /** Where one message's Nth attachment sits in `files`, or -1 if the
   *  message contributed nothing (filtered out, or not found). */
  indexOf: (messageId: string, localIndex: number) => number
}

const EMPTY: ConversationGalleryApi = { files: [], indexOf: () => -1 }

const ConversationGalleryContext = createContext<ConversationGalleryApi>(EMPTY)

export function useConversationGallery(): ConversationGalleryApi {
  return useContext(ConversationGalleryContext)
}

function senderNameOf(m: GalleryMessage, intl: IntlShape, visitorIsSelf: boolean): string | undefined {
  if (m.author?.displayName) return m.author.displayName
  if (m.isAssistant) {
    return intl.formatMessage({ id: 'files.sender.assistant', defaultMessage: 'Assistant' })
  }
  if (m.senderType === 'agent') {
    return intl.formatMessage({ id: 'files.sender.agent', defaultMessage: 'Agent' })
  }
  if (m.senderType === 'visitor') {
    // In the visitor's own view of their thread (the widget/portal) a
    // visitor-authored file is the viewer's own, same as the bubble's "You";
    // in the agent inbox it belongs to someone else, so it stays "Visitor".
    return visitorIsSelf
      ? intl.formatMessage({ id: 'widget.messenger.you', defaultMessage: 'You' })
      : intl.formatMessage({ id: 'files.sender.visitor', defaultMessage: 'Visitor' })
  }
  return undefined
}

export function ConversationGalleryProvider({
  messages,
  includeInternal = false,
  visitorIsSelf = !includeInternal,
  children,
}: {
  messages: GalleryMessage[]
  /** Agent threads pass true — internal notes are agent-only; the visitor
   *  widget/portal leave this at its default so a note's attachments (which
   *  should never reach a visitor DTO in the first place) can never surface
   *  in their gallery either. */
  includeInternal?: boolean
  /** Whether the person viewing this thread IS the visitor whose messages
   *  carry senderType 'visitor' — true in the widget/portal's own view of
   *  their conversation (where a visitor's file is labeled "You", matching
   *  the bubble), false in the agent inbox (where it belongs to someone
   *  else and stays "Visitor"). Defaults to the opposite of `includeInternal`
   *  since today's two mounts line up exactly that way; pass it explicitly
   *  if that ever stops holding. */
  visitorIsSelf?: boolean
  children: ReactNode
}) {
  const intl = useIntl()
  const value = useMemo<ConversationGalleryApi>(() => {
    const files: ViewerFile[] = []
    const startIndexByMessage = new Map<string, number>()
    for (const m of messages) {
      if (m.isInternal && !includeInternal) continue
      const safe = (m.attachments ?? []).filter(isSafeAttachment)
      if (safe.length === 0) continue
      startIndexByMessage.set(m.id, files.length)
      const senderName = senderNameOf(m, intl, visitorIsSelf)
      safe.forEach((a, index) => {
        files.push(toViewerFile(a, { senderName, sentAt: m.createdAt, messageId: m.id, index }))
      })
    }
    return {
      files,
      indexOf: (messageId, localIndex) => {
        const start = startIndexByMessage.get(messageId)
        return start === undefined ? -1 : start + localIndex
      },
    }
  }, [messages, includeInternal, visitorIsSelf, intl])

  return (
    <ConversationGalleryContext.Provider value={value}>
      {children}
    </ConversationGalleryContext.Provider>
  )
}
