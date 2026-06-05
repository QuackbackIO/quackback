import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serializeConversation } from './serialize'
import type { ConversationId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/conversations/$conversationId')({
  server: {
    handlers: {
      /** GET /api/v1/conversations/:id — single conversation (team API key). */
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )

          const { assertConversationViewable } =
            await import('@/lib/server/domains/chat/chat.service')
          const { conversationToDTO } = await import('@/lib/server/domains/chat/chat.query')
          const { segmentIdsForPrincipal } =
            await import('@/lib/server/domains/segments/segment-membership.service')

          // Team-role API keys are service principals; canViewConversation allows
          // any team actor (role-based), so segments only matter for non-team callers.
          const actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service' as const,
            segmentIds: await segmentIdsForPrincipal(auth.principalId),
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
