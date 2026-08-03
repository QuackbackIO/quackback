/**
 * POST /api/v1/conversations/:conversationId/reply — send a public agent reply.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  createdResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { buildChatActor, buildChatAgent } from './-chat-actor'
import type { ConversationId } from '@quackback/ids'

const bodySchema = z.object({ content: z.string().min(1).max(4000) })

export const Route = createFileRoute('/api/v1/conversations/$conversationId/reply')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.CHAT_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.CHAT_MANAGE)) {
            return forbiddenResponse('chat.manage permission required')
          }
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const parsed = bodySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { sendAgentMessage } = await import('@/lib/server/domains/chat/chat.service')
          const result = await sendAgentMessage(
            conversationId,
            parsed.data.content,
            buildChatAgent(auth),
            buildChatActor(auth)
          )
          return createdResponse({
            id: result.message.id,
            conversationId: result.message.conversationId,
            status: result.conversation.status,
            createdAt: result.message.createdAt,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
