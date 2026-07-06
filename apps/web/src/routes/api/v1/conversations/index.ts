import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeConversation } from './-serialize'
import type { ConversationStatus, ConversationPriority } from '@/lib/server/db'
import type { PrincipalId, SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/conversations/')({
  server: {
    handlers: {
      /** GET /api/v1/conversations — list conversations (team API key). */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.CONVERSATION_VIEW })

          const url = new URL(request.url)
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
          )
          const status = (url.searchParams.get('status') as ConversationStatus | null) ?? undefined
          const priority =
            (url.searchParams.get('priority') as ConversationPriority | null) ?? undefined
          const assignedAgentPrincipalId =
            (url.searchParams.get('assignedAgentPrincipalId') as PrincipalId | null) ?? undefined

          // A service (API key) actor sees every conversation via
          // conversationFilter's service-principal branch, mirroring the
          // ticket REST route's inline actor.
          const actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service' as const,
            segmentIds: new Set<SegmentId>(),
          }

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
