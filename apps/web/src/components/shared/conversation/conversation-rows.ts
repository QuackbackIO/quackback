import type {
  ConversationMessageDTO,
  AssistantActivityStatus,
} from '@/lib/shared/conversation/types'

/**
 * A single virtualized row in the conversation thread. Messages are keyed by their id
 * (stable across prepend, so the virtualizer can anchor the viewport when older
 * history loads); the surrounding affordances use fixed keys.
 */
export type ConversationRow =
  | { type: 'load-older'; key: 'load-older' }
  | { type: 'greeting'; key: 'greeting' }
  | { type: 'message'; key: string; message: ConversationMessageDTO }
  | { type: 'system'; key: string; message: ConversationMessageDTO }
  | { type: 'empty'; key: 'empty' }
  | { type: 'seen'; key: 'seen' }
  | { type: 'typing'; key: 'typing' }
  // Ephemeral AI-assistant rows: the live working trace, or the answer as it
  // streams (replaced by the persisted message row when the turn lands).
  | { type: 'assistant-activity'; key: 'assistant-activity'; status: AssistantActivityStatus }
  | { type: 'assistant-stream'; key: 'assistant-stream'; text: string }
  | { type: 'csat'; key: 'csat' }

export interface ConversationRowsInput {
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
  /** Quinn's current working status while its turn runs (null when idle). */
  assistantActivity: AssistantActivityStatus | null
  /** Quinn's answer as it streams, before the persisted message lands (''=none). */
  assistantStream: string
  /** Post-conversation CSAT prompt / thanks. */
  showCsat: boolean
}

/**
 * Flatten the conversation thread into an ordered, stable-keyed row list for the
 * virtualizer: load-older → greeting → messages → seen → typing → csat. Pure so
 * the ordering/keying is unit-tested directly.
 */
export function buildConversationRows(input: ConversationRowsInput): ConversationRow[] {
  const rows: ConversationRow[] = []
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
  // Streamed answer supersedes the working trace once text arrives; both are
  // dropped the moment the persisted assistant message enters `messages`.
  if (input.assistantStream) {
    rows.push({ type: 'assistant-stream', key: 'assistant-stream', text: input.assistantStream })
  } else if (input.assistantActivity) {
    rows.push({
      type: 'assistant-activity',
      key: 'assistant-activity',
      status: input.assistantActivity,
    })
  }
  if (input.showCsat) rows.push({ type: 'csat', key: 'csat' })
  return rows
}
