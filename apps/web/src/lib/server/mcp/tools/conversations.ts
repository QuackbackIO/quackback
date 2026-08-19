/**
 * Support-inbox conversation tools: list/read threads, agent replies, post
 * cards (suggest/share), and status changes. All are team-only agent surfaces.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CONVERSATION_STATUSES } from '@/lib/shared/db-types'
import { realEmail } from '@/lib/shared/anonymous-email'
import type { PostId, BoardId, ConversationId, PrincipalId } from '@quackback/ids'
import type { McpAuthContext } from '../types'
import {
  registerTool,
  agentFromMcpAuth,
  mcpAgentActor,
  jsonResult,
  compactJsonResult,
  READ_ONLY,
  WRITE,
} from './helpers'

// ============================================================================
// Tool registration
// ============================================================================

export function registerConversationTools(server: McpServer, auth: McpAuthContext) {
  registerTool<{
    status?: 'open' | 'snoozed' | 'closed'
    priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
    assignedAgentPrincipalId?: string
    cursor?: string
    limit?: number
  }>(server, auth, {
    name: 'list_conversations',
    description: `List support-inbox conversations, newest activity first. Filter by status, priority, or assigned agent; paginate with cursor.

Examples:
- Open conversations: list_conversations({ status: "open" })
- A specific agent's queue: list_conversations({ assignedAgentPrincipalId: "principal_01abc..." })`,
    schema: {
      status: z.enum(CONVERSATION_STATUSES).optional().describe('Filter by status'),
      priority: z
        .enum(['none', 'low', 'medium', 'high', 'urgent'])
        .optional()
        .describe('Filter by priority'),
      assignedAgentPrincipalId: z
        .string()
        .optional()
        .describe('Filter to a specific assigned agent (principal TypeID)'),
      cursor: z.string().optional().describe('Pagination cursor from a previous response'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
    },
    annotations: READ_ONLY,
    scope: 'read:chat',
    teamOnly: true,
    handler: async (args) => {
      const { listConversationsForAgent } =
        await import('@/lib/server/domains/conversation/conversation.query')
      const result = await listConversationsForAgent(
        {
          status: args.status,
          priority: args.priority,
          assignedAgentPrincipalId: args.assignedAgentPrincipalId as PrincipalId | undefined,
          before: args.cursor,
          limit: args.limit ?? 20,
        },
        mcpAgentActor(auth)
      )
      return compactJsonResult({
        conversations: result.conversations.map((c) => ({
          id: c.id,
          status: c.status,
          priority: c.priority,
          channel: c.channel,
          subject: c.subject,
          lastMessageAt: c.lastMessageAt,
          visitorPrincipalId: c.visitor.principalId,
          assignedAgentPrincipalId: c.assignedAgent?.principalId ?? null,
        })),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      })
    },
  })

  registerTool<{
    conversationId: string
    includeInternal?: boolean
    cursor?: string
  }>(server, auth, {
    name: 'get_conversation',
    description: `Get a conversation and its most recent messages. Set includeInternal to also return agent-only internal notes.

Example: get_conversation({ conversationId: "conversation_01abc...", includeInternal: true })`,
    schema: {
      conversationId: z.string().describe('Conversation TypeID'),
      includeInternal: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include agent-only internal notes'),
      cursor: z
        .string()
        .optional()
        .describe('Cursor from a previous get_conversation response to fetch older messages'),
    },
    annotations: READ_ONLY,
    scope: 'read:chat',
    teamOnly: true,
    handler: async (args) => {
      const { assertConversationViewable } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const { listMessages, conversationToDTO } =
        await import('@/lib/server/domains/conversation/conversation.query')
      const conversationId = args.conversationId as ConversationId
      const conversation = await assertConversationViewable(conversationId, mcpAgentActor(auth))
      const [dto, page] = await Promise.all([
        conversationToDTO(conversation, 'agent'),
        listMessages(conversationId, {
          before: args.cursor,
          includeInternal: args.includeInternal ?? false,
          limit: 30,
        }),
      ])
      return jsonResult({
        conversation: {
          id: dto.id,
          status: dto.status,
          priority: dto.priority,
          channel: dto.channel,
          subject: dto.subject,
          visitorPrincipalId: dto.visitor.principalId,
          visitorEmail: realEmail(dto.visitorEmail),
          assignedAgentPrincipalId: dto.assignedAgent?.principalId ?? null,
          lastMessageAt: dto.lastMessageAt,
          resolvedAt: dto.resolvedAt,
          createdAt: dto.createdAt,
        },
        messages: page.messages.map((m) => ({
          id: m.id,
          senderType: m.senderType,
          isInternal: m.isInternal,
          authorName: m.author?.displayName ?? null,
          content: m.content,
          createdAt: m.createdAt,
        })),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      })
    },
  })

  registerTool<{ conversationId: string; content: string }>(server, auth, {
    name: 'reply_to_conversation',
    description: `Send an agent reply in a conversation (visible to the visitor). Auto-assigns the conversation to the calling agent if unassigned.

Example: reply_to_conversation({ conversationId: "conversation_01abc...", content: "Thanks for reaching out — we're on it." })`,
    schema: {
      conversationId: z.string().describe('Conversation TypeID'),
      content: z.string().min(1).max(4000).describe('Reply text sent to the visitor'),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { sendAgentMessage } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const agent = agentFromMcpAuth(auth)
      const result = await sendAgentMessage(
        args.conversationId as ConversationId,
        args.content,
        agent,
        mcpAgentActor(auth)
      )
      return jsonResult({
        id: result.message.id,
        conversationId: result.message.conversationId,
        status: result.conversation.status,
        createdAt: result.message.createdAt,
      })
    },
  })

  // suggest_post — agent-only; nudges the team to track a RESOLVED conversation
  // as a post. Never reaches the visitor. The agent confirms with one click.
  registerTool<{
    conversationId: string
    boardId: string
    title: string
    content: string
  }>(server, auth, {
    name: 'suggest_post',
    description: `Suggest to the SUPPORT TEAM (not the visitor) that a RESOLVED conversation be tracked as a feedback post. Appears only in the agent inbox as an internal note; a team member confirms with one click. Rejected unless the conversation is resolved.

Example: suggest_post({ conversationId: "conversation_01...", boardId: "board_01...", title: "Add dark mode", content: "Customer asked for a night theme." })`,
    schema: {
      conversationId: z.string().describe('Conversation TypeID (must be resolved)'),
      boardId: z.string().describe('Suggested board TypeID'),
      title: z.string().min(3).max(200),
      content: z.string().max(10000).default(''),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { suggestPost } = await import('@/lib/server/domains/conversation/conversation.cards')
      const agent = agentFromMcpAuth(auth)
      const r = await suggestPost(
        {
          conversationId: args.conversationId as ConversationId,
          boardId: args.boardId as BoardId,
          title: args.title,
          content: args.content,
        },
        { agentActor: mcpAgentActor(auth), agentPrincipalId: auth.principalId, agent }
      )
      return jsonResult({ messageId: r.messageId, conversationId: args.conversationId })
    },
  })

  registerTool<{ conversationId: string; postId: string }>(server, auth, {
    name: 'share_post',
    description: `Embed an EXISTING feedback post as a card in the conversation so the visitor can view and upvote it. Find
candidates first with the search tool. Use to surface related ideas / avoid duplicates.

Example: share_post({ conversationId: "conversation_01...", postId: "post_01..." })`,
    schema: {
      conversationId: z.string().describe('Conversation TypeID'),
      postId: z.string().describe('Post TypeID'),
    },
    annotations: WRITE,
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { sharePost } = await import('@/lib/server/domains/conversation/conversation.cards')
      const agent = agentFromMcpAuth(auth)
      const r = await sharePost(
        { conversationId: args.conversationId as ConversationId, postId: args.postId as PostId },
        { agentActor: mcpAgentActor(auth), agentPrincipalId: auth.principalId, agent }
      )
      return jsonResult({ messageId: r.message.id })
    },
  })

  registerTool<{
    conversationId: string
    status: 'open' | 'snoozed' | 'closed'
  }>(server, auth, {
    name: 'set_conversation_status',
    description: `Change a conversation's status (open, snoozed, or closed). Snoozing defers it until the customer next replies; closing stamps the resolution time; a later reply reopens it.

Example: set_conversation_status({ conversationId: "conversation_01abc...", status: "closed" })`,
    schema: {
      conversationId: z.string().describe('Conversation TypeID'),
      status: z.enum(CONVERSATION_STATUSES).describe('New status'),
    },
    annotations: { ...WRITE, idempotentHint: true },
    scope: 'write:chat',
    teamOnly: true,
    handler: async (args) => {
      const { setConversationStatus } =
        await import('@/lib/server/domains/conversation/conversation.service')
      const updated = await setConversationStatus(
        args.conversationId as ConversationId,
        args.status,
        mcpAgentActor(auth)
      )
      return jsonResult({ id: updated.id, status: updated.status })
    },
  })
}
