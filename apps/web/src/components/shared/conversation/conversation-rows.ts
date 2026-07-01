import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'

/**
 * A single virtualized row in the chat thread. Messages are keyed by their id
 * (stable across prepend, so the virtualizer can anchor the viewport when older
 * history loads); the surrounding affordances use fixed keys.
 */
export type ChatRow =
  | { type: 'load-older'; key: 'load-older' }
  | { type: 'greeting'; key: 'greeting' }
  | { type: 'message'; key: string; message: ConversationMessageDTO }
  | { type: 'system'; key: string; message: ConversationMessageDTO }
  | { type: 'empty'; key: 'empty' }
  | { type: 'seen'; key: 'seen' }
  | { type: 'typing'; key: 'typing' }
  | { type: 'csat'; key: 'csat' }

export interface ChatRowsInput {
  messages: ConversationMessageDTO[]
  /** A "load earlier messages" affordance sits above the thread. */
  hasMoreOlder: boolean
  /** The settings-driven welcome bubble (only once the thread start is reached). */
  hasGreeting: boolean
  /** Empty-thread prompt (no messages and no greeting). */
  showEmpty: boolean
  /** "Seen" watermark on the visitor's latest message. */
  showSeen: boolean
  /** Agent typing indicator. */
  showTyping: boolean
  /** Post-conversation CSAT prompt / thanks. */
  showCsat: boolean
}

/**
 * Flatten the chat thread into an ordered, stable-keyed row list for the
 * virtualizer: load-older → greeting → messages → seen → typing → csat. Pure so
 * the ordering/keying is unit-tested directly.
 */
export function buildChatRows(input: ChatRowsInput): ChatRow[] {
  const rows: ChatRow[] = []
  if (input.hasMoreOlder) rows.push({ type: 'load-older', key: 'load-older' })
  if (input.hasGreeting) rows.push({ type: 'greeting', key: 'greeting' })
  for (const message of input.messages) {
    // System events (e.g. "assigned to …") render as a centered notice, not a
    // bubble. An embedded post rides on contentJson and routes to a normal row.
    const type = message.senderType === 'system' ? 'system' : 'message'
    rows.push({ type, key: message.id, message })
  }
  if (input.showEmpty) rows.push({ type: 'empty', key: 'empty' })
  if (input.showSeen) rows.push({ type: 'seen', key: 'seen' })
  if (input.showTyping) rows.push({ type: 'typing', key: 'typing' })
  if (input.showCsat) rows.push({ type: 'csat', key: 'csat' })
  return rows
}
