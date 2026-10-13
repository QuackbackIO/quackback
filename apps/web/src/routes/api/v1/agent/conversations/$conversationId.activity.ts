import { createFileRoute } from '@tanstack/react-router'
import { withAgentAuth } from '@/lib/server/domains/api/agent-auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { agentActivityBodySchema } from '@/lib/server/domains/support-agents/agent-api.schemas'
import type { ConversationId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/agent/conversations/$conversationId/activity')({
  server: {
    handlers: {
      /** POST /api/v1/agent/conversations/:id/activity: show the customer that the agent is working. */
      POST: async ({ request, params }) => {
        try {
          const agent = await withAgentAuth(request)
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const parsed = agentActivityBodySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { setAgentActivity } =
            await import('@/lib/server/domains/support-agents/agent-actions.service')
          await setAgentActivity(agent, conversationId, parsed.data.status)
          return successResponse({ accepted: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
