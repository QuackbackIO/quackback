import { createFileRoute } from '@tanstack/react-router'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseCursor, parseLimit } from '@/lib/server/domains/api/request'
import { parseOptionalTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeConversation } from './-serialize'
import type { ConversationStatus, ConversationPriority } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/conversations/')({
  server: {
    handlers: {
      /** GET /api/v1/conversations — list conversations (team API key). */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.CONVERSATION_VIEW })

          const url = new URL(request.url)
          const cursor = parseCursor(url)
          const limit = parseLimit(url)
          const status = (url.searchParams.get('status') as ConversationStatus | null) ?? undefined
          const priority =
            (url.searchParams.get('priority') as ConversationPriority | null) ?? undefined
          const assignedAgentPrincipalId = parseOptionalTypeId<PrincipalId>(
            url.searchParams.get('assignedAgentPrincipalId'),
            'principal',
            'assignedAgentPrincipalId'
          )

          // A personal key lists only what its creator can see
          // (conversationFilter follows the actor's scopePrincipalId).
          const actor = serviceActorFromApiAuth(auth)

          const { listConversationsForAgent } =
            await import('@/lib/server/domains/conversation/conversation.query')
          const result = await listConversationsForAgent(
            {
              status,
              priority,
              assignedAgentPrincipalId,
              before: cursor,
              limit,
            },
            actor
          )

          return successResponse(result.conversations.map(serializeConversation), {
            pagination: { cursor: result.nextCursor, hasMore: result.hasMore },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
