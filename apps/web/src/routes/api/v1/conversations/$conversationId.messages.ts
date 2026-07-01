import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeMessage } from './-serialize'
import type { ConversationId, SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/conversations/$conversationId/messages')({
  server: {
    handlers: {
      /** GET /api/v1/conversations/:id/messages — internal notes excluded unless includeInternal=true. */
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.CONVERSATION_VIEW })
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )

          const url = new URL(request.url)
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30)
          )
          const includeInternal = url.searchParams.get('includeInternal') === 'true'

          const { assertConversationViewable } =
            await import('@/lib/server/domains/conversation/conversation.service')
          const { listMessages } =
            await import('@/lib/server/domains/conversation/conversation.query')

          // team-role API key: canViewConversation short-circuits on role; segments unused
          const actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service' as const,
            segmentIds: new Set<SegmentId>(),
          }

          // 404 if the conversation doesn't exist or isn't viewable (before listing messages).
          await assertConversationViewable(conversationId, actor)

          const result = await listMessages(conversationId, {
            before: cursor,
            limit,
            includeInternal,
          })
          return successResponse(result.messages.map(serializeMessage), {
            pagination: { cursor: result.nextCursor, hasMore: result.hasMore },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
