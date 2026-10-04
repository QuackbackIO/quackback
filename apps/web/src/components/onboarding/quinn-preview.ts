import type { ConversationMessageId } from '@quackback/ids'
import type { AgentThreadCache } from '@/components/conversation/events-reducer'
import { asAgentMessage, type ConversationStreamEvent } from '@/lib/shared/conversation/types'

/** The one placeholder row a streaming Quinn turn occupies until its reply lands. */
export const QUINN_PREVIEW_ID = 'conversation_msg_quinn_preview' as ConversationMessageId

function withoutPreview(thread: AgentThreadCache): AgentThreadCache {
  if (!thread.messages.some((m) => m.id === QUINN_PREVIEW_ID)) return thread
  return { ...thread, messages: thread.messages.filter((m) => m.id !== QUINN_PREVIEW_ID) }
}

/**
 * Show Quinn's live turn in an inbox thread: each delta carries the whole
 * answer so far, an empty one retracts it, and the persisted reply replaces it.
 * Every other event leaves the thread to the regular reducer.
 */
export function applyQuinnPreview(
  thread: AgentThreadCache | undefined,
  event: ConversationStreamEvent
): AgentThreadCache | undefined {
  if (!thread) return thread
  if (event.kind === 'message') return event.message.isAssistant ? withoutPreview(thread) : thread
  if (event.kind !== 'assistant_delta') return thread
  const rest = withoutPreview(thread)
  if (!event.text) return rest
  const author = [...rest.messages].reverse().find((m) => m.isAssistant)?.author ?? null
  const preview = asAgentMessage({
    id: QUINN_PREVIEW_ID,
    conversationId: thread.conversation.id,
    ticketId: null,
    senderType: 'agent',
    content: event.text,
    createdAt: event.at,
    author,
    attachments: [],
    citations: [],
    isAssistant: true,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
  })
  return { ...rest, messages: [...rest.messages, preview] }
}
