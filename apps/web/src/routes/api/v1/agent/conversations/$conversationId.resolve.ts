import { createFileRoute } from '@tanstack/react-router'
import { withAgentAuth } from '@/lib/server/domains/api/agent-auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { agentResolveBodySchema } from '@/lib/server/domains/support-agents/agent-api.schemas'
import type { ConversationId, SupportAgentTurnId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/agent/conversations/$conversationId/resolve')({
  server: {
    handlers: {
      /** POST /api/v1/agent/conversations/:id/resolve: record that the agent resolved the customer's question. */
      POST: async ({ request, params }) => {
        try {
          const agent = await withAgentAuth(request)
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const parsed = agentResolveBodySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { assertAgentControls, resolveAsAgent } =
            await import('@/lib/server/domains/support-agents/agent-actions.service')
          await assertAgentControls(agent, conversationId)
          const result = await resolveAsAgent({
            agent,
            conversationId,
            turnId: parsed.data.turnId as SupportAgentTurnId,
            confirmed: parsed.data.confirmed,
            summary: parsed.data.summary,
          })
          return successResponse(result)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
