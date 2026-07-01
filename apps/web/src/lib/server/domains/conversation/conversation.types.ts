import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationMessageMetadata } from '@/lib/server/db'
import type {
  ConversationAttachment,
  ConversationMessageDTO,
  ConversationDTO,
} from '@/lib/shared/conversation/types'

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
}

export interface SendVisitorMessageResult {
  conversation: ConversationDTO
  message: ConversationMessageDTO
  /** True when this send created the conversation (first message). */
  created: boolean
}

export interface SendAgentMessageResult {
  conversation: ConversationDTO
  message: ConversationMessageDTO
}
