/**
 * POST /api/v1/conversations/:conversationId/end — end a conversation with a
 * reason (resolved | tracked_as_feedback | duplicate | no_response | spam | other)
 * and an optional internal note.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { CONVERSATION_END_REASONS } from '@/lib/server/db'
import { buildChatActor } from './-chat-actor'
import type { ConversationId } from '@quackback/ids'

const bodySchema = z.object({
  reason: z.enum(CONVERSATION_END_REASONS),
  note: z.string().max(2000).nullable().optional(),
})

export const Route = createFileRoute('/api/v1/conversations/$conversationId/end')({
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
          const { endConversation } = await import('@/lib/server/domains/chat/chat.service')
          const updated = await endConversation(
            conversationId,
            parsed.data.reason,
            parsed.data.note ?? null,
            buildChatActor(auth)
          )
          return successResponse(updated)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
