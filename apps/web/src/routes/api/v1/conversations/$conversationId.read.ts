import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { ConversationId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/conversations/$conversationId/read')({
  server: {
    handlers: {
      /** POST /api/v1/conversations/:id/read — mark read up to now for the agent
       *  side. Gated conversation.set_status (D10): marking read publishes a
       *  realtime `read` event that clears the unread signal human agents see, so
       *  it mutates team-visible state — a write, not a read. */
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

          const actor = serviceActorFromApiAuth(auth)
          const { markConversationRead } =
            await import('@/lib/server/domains/conversation/conversation.service')
          await markConversationRead(conversationId, actor)

          return successResponse({ ok: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
