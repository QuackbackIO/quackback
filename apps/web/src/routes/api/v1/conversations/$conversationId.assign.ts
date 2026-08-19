import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeConversation } from './-serialize'
import type { ConversationId, PrincipalId } from '@quackback/ids'

// null or omitted = unassign; no 'me' sentinel for a service key (it has no
// personal identity to resolve to).
const assignSchema = z.object({
  assigneePrincipalId: z.string().nullable().optional(),
})

export const Route = createFileRoute('/api/v1/conversations/$conversationId/assign')({
  server: {
    handlers: {
      /** POST /api/v1/conversations/:id/assign — (re)assign to a teammate, or unassign. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.CONVERSATION_ASSIGN,
          })
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )

          const parsed = assignSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const agentPrincipalId =
            parsed.data.assigneePrincipalId == null
              ? null
              : parseTypeId<PrincipalId>(
                  parsed.data.assigneePrincipalId,
                  'principal',
                  'assignee principal ID'
                )

          const actor = serviceActorFromApiAuth(auth)
          const { assignConversation } =
            await import('@/lib/server/domains/conversation/conversation.service')
          const { conversationToDTO } =
            await import('@/lib/server/domains/conversation/conversation.query')
          const updated = await assignConversation(conversationId, agentPrincipalId, actor)
          const dto = await conversationToDTO(updated, 'agent')

          return successResponse(serializeConversation(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
