import type { ChatMessageId } from '@quackback/ids'
import type { AgentChatMessageDTO } from '@/lib/shared/chat/types'

/**
 * A single virtualized row in the admin message thread. Messages are keyed by
 * their id (stable across prepend, so the virtualizer can hold the viewport when
 * older history loads); the surrounding affordances use fixed keys. System
 * events stay as `message` rows — AdminBubble renders them as a centered notice.
 */
export type AdminChatRow =
  | { type: 'load-older'; key: 'load-older' }
  | { type: 'unread'; key: 'unread' }
  | { type: 'message'; key: string; message: AgentChatMessageDTO }
  | { type: 'empty'; key: 'empty' }
  | { type: 'seen'; key: 'seen' }
  | { type: 'typing'; key: 'typing' }

export interface AdminChatRowsInput {
  messages: AgentChatMessageDTO[]
  /** A "load earlier messages" affordance sits above the thread. */
  hasMoreOlder: boolean
  /** First message past the agent's read watermark — gets the "New" divider. */
  firstUnreadId: ChatMessageId | null
  /** "Seen" watermark on the agent's latest reply. */
  showSeen: boolean
  /** Visitor typing indicator. */
  showTyping: boolean
}

/**
 * Flatten the admin thread into an ordered, stable-keyed row list for the
 * virtualizer: load-older → [unread divider +] messages → empty → seen →
 * typing. Pure so the ordering/keying is unit-testable directly.
 */
export function buildAdminChatRows(input: AdminChatRowsInput): AdminChatRow[] {
  const rows: AdminChatRow[] = []
  if (input.hasMoreOlder) rows.push({ type: 'load-older', key: 'load-older' })
  for (const message of input.messages) {
    // The unread divider sits immediately above the first unread message.
    if (message.id === input.firstUnreadId) rows.push({ type: 'unread', key: 'unread' })
    rows.push({ type: 'message', key: message.id, message })
  }
  if (input.messages.length === 0) rows.push({ type: 'empty', key: 'empty' })
  if (input.showSeen) rows.push({ type: 'seen', key: 'seen' })
  if (input.showTyping) rows.push({ type: 'typing', key: 'typing' })
  return rows
}
