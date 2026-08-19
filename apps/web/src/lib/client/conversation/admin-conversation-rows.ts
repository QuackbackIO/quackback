import type { ConversationMessageId } from '@quackback/ids'
import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import type { BlockState } from '@/lib/shared/conversation/types'

/**
 * A single virtualized row in the admin message thread. Messages are keyed by
 * their id (stable across prepend, so the virtualizer can hold the viewport when
 * older history loads); the surrounding affordances use fixed keys. System
 * events stay as `message` rows; AgentMessageBubble renders them as a centered
 * notice.
 */
export type AdminConversationRow =
  | { type: 'load-older'; key: 'load-older' }
  | { type: 'unread'; key: 'unread' }
  // `blockState` mirrors conversation-rows.ts's ConversationRow (the widget's
  // own row type) — set only when `message.block` is an interactive kind, so
  // AgentMessageBubble's read-only summary can stop implying an answered
  // block is still live (CF3).
  | { type: 'message'; key: string; message: AgentConversationMessageDTO; blockState?: BlockState }
  | { type: 'empty'; key: 'empty' }
  | { type: 'seen'; key: 'seen' }
  | { type: 'typing'; key: 'typing' }

export interface AdminConversationRowsInput {
  messages: AgentConversationMessageDTO[]
  /** A "load earlier messages" affordance sits above the thread. */
  hasMoreOlder: boolean
  /** First message past the agent's read watermark — gets the "New" divider. */
  firstUnreadId: ConversationMessageId | null
  /** "Seen" watermark on the agent's latest reply. */
  showSeen: boolean
  /** Visitor typing indicator. */
  showTyping: boolean
  /** Every interactive block message's derived state (conversation-rows.ts's
   *  `computeBlockStates`), keyed by message id. Optional — omitted by ticket
   *  threads (which never carry a block) and by any caller that hasn't
   *  computed it yet; those messages simply get no `blockState`. */
  blockStates?: Map<string, BlockState>
}

/**
 * Flatten the admin thread into an ordered, stable-keyed row list for the
 * virtualizer: load-older → [unread divider +] messages → empty → seen →
 * typing. Pure so the ordering/keying is unit-testable directly.
 */
export function buildAdminConversationRows(
  input: AdminConversationRowsInput
): AdminConversationRow[] {
  const rows: AdminConversationRow[] = []
  if (input.hasMoreOlder) rows.push({ type: 'load-older', key: 'load-older' })
  for (const message of input.messages) {
    // The unread divider sits immediately above the first unread message.
    if (message.id === input.firstUnreadId) rows.push({ type: 'unread', key: 'unread' })
    const blockState = input.blockStates?.get(message.id as unknown as string)
    rows.push({ type: 'message', key: message.id, message, blockState })
  }
  if (input.messages.length === 0) rows.push({ type: 'empty', key: 'empty' })
  if (input.showSeen) rows.push({ type: 'seen', key: 'seen' })
  if (input.showTyping) rows.push({ type: 'typing', key: 'typing' })
  return rows
}
