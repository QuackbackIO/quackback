import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeConversation } from './-serialize'
import type { ConversationId, SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/conversations/$conversationId')({
  server: {
    handlers: {
      /** GET /api/v1/conversations/:id — single conversation (team API key). */
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.CONVERSATION_VIEW })
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )

          const { assertConversationViewable } =
            await import('@/lib/server/domains/conversation/conversation.service')
          const { conversationToDTO } =
            await import('@/lib/server/domains/conversation/conversation.query')

          // team-role API key: canViewConversation short-circuits on role; segments unused
          const actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service' as const,
            segmentIds: new Set<SegmentId>(),
          }

          const conversation = await assertConversationViewable(conversationId, actor)
          const dto = await conversationToDTO(conversation, 'agent')
          return successResponse(serializeConversation(dto))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
