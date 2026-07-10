import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationMessageMetadata } from '@/lib/server/db'
import type {
  ConversationAttachment,
  ConversationMessageDTO,
  AgentConversationMessageDTO,
  ConversationDTO,
} from '@/lib/shared/conversation/types'
import type { BlockReplyInput } from './block-reply'

/** Author identity passed into a send call (resolved from the auth context). */
export interface ConversationAuthorInput {
  principalId: PrincipalId
  displayName?: string | null
  avatarUrl?: string | null
  /** Email is used only by the offline-notification path, never rendered. */
  email?: string | null
}

/** Visitor send: omit conversationId to start a new conversation. */
export interface SendVisitorMessageInput {
  conversationId?: ConversationId
  content: string
  attachments?: ConversationAttachment[]
  /** Optional pre-chat email; stored on the conversation if not already set. */
  visitorEmail?: string
  /** Channel provenance (e.g. inbound email message-id) persisted on the message. */
  metadata?: ConversationMessageMetadata
  /** A structured reply to a conversational block (Phase C, slice C-1) — the
   *  client's claimed answer, re-derived/validated server-side (see
   *  block-reply.ts's resolveBlockReply) before it's ever trusted. Degrades
   *  to an ordinary free-text send (using `content` above) rather than an
   *  error when invalid, stale, or a second reply to an already-answered
   *  block. */
  blockReply?: BlockReplyInput
}

export interface SendVisitorMessageResult {
  conversation: ConversationDTO
  message: ConversationMessageDTO
  /** True when this send created the conversation (first message). */
  created: boolean
}

export interface SendAgentMessageResult {
  conversation: ConversationDTO
  // Agent-only DTO (mirrors enrichMessagesForAgent's shape) so the sending
  // agent's own response — and the inbox-only message_updated broadcast to
  // other agents — carries translatedFrom (P2-D.1). Never handed to a visitor.
  message: AgentConversationMessageDTO
}
