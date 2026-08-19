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
import { priorityEnum } from './-validation'
import type { ConversationId } from '@quackback/ids'

const prioritySchema = z.object({
  priority: priorityEnum,
})

export const Route = createFileRoute('/api/v1/conversations/$conversationId/priority')({
  server: {
    handlers: {
      /** POST /api/v1/conversations/:id/priority — set triage priority (gated conversation.set_status). */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.CONVERSATION_SET_STATUS,
          })
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )

          const parsed = prioritySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const { setConversationPriority } =
            await import('@/lib/server/domains/conversation/conversation.service')
          const { conversationToDTO } =
            await import('@/lib/server/domains/conversation/conversation.query')
          const updated = await setConversationPriority(conversationId, parsed.data.priority, actor)
          const dto = await conversationToDTO(updated, 'agent')

          return successResponse(serializeConversation(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
