/**
 * Conversation domain module exports (channel-agnostic: live chat, email, web forms).
 *
 * IMPORTANT: This barrel only re-exports types. Service/query functions that
 * touch the database are NOT exported here so they never get bundled into the
 * client. Import them directly from './conversation.service' / './conversation.query' in
 * server-only code (server functions, API routes).
 */
export type {
  ChatAuthorInput,
  SendVisitorMessageInput,
  SendVisitorMessageResult,
  SendAgentMessageResult,
} from './conversation.types'
