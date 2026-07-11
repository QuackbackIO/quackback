/**
 * POST /api/v1/conversations/:conversationId/assign — assign (or unassign) the
 * conversation to an agent principal. Pass agentPrincipalId: null to unassign.
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
import { buildChatActor } from './-chat-actor'
import type { ConversationId, PrincipalId } from '@quackback/ids'

const bodySchema = z.object({ agentPrincipalId: z.string().nullable() })

export const Route = createFileRoute('/api/v1/conversations/$conversationId/assign')({
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
          const { assignConversation } = await import('@/lib/server/domains/chat/chat.service')
          const updated = await assignConversation(
            conversationId,
            (parsed.data.agentPrincipalId as PrincipalId | null) ?? null,
            buildChatActor(auth)
          )
          return successResponse({
            id: updated.id,
            assignedAgentPrincipalId: updated.assignedAgentPrincipalId,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
