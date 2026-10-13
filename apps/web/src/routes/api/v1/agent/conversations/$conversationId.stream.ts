import { createFileRoute } from '@tanstack/react-router'
import { withAgentAuth } from '@/lib/server/domains/api/agent-auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { ndjsonTextChunks } from '@/lib/server/domains/support-agents/ndjson'
import { AGENT_MAX_REPLY_LENGTH } from '@/lib/shared/support-agents'
import type { ConversationId, SupportAgentTurnId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/agent/conversations/$conversationId/stream')({
  server: {
    handlers: {
      /**
       * POST /api/v1/agent/conversations/:id/stream?turnId=: one request per turn.
       * The body is newline-delimited JSON, one `{"text": "..."}` chunk per line,
       * shown to the customer as it arrives. The reply endpoint still posts the answer.
       */
      POST: async ({ request, params }) => {
        try {
          const agent = await withAgentAuth(request)
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const turnParam = new URL(request.url).searchParams.get('turnId')
          if (!turnParam || !request.body) {
            return badRequestResponse('turnId and a streamed body are required')
          }
          const turnId = parseTypeId<SupportAgentTurnId>(turnParam, 'support_agent_turn', 'turn ID')
          const { streamAgentText } =
            await import('@/lib/server/domains/support-agents/agent-actions.service')
          const result = await streamAgentText(
            agent,
            conversationId,
            turnId,
            ndjsonTextChunks(request.body),
            AGENT_MAX_REPLY_LENGTH
          )
          return successResponse(result)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
