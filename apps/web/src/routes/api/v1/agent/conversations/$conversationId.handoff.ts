import { createFileRoute } from '@tanstack/react-router'
import { withAgentAuth } from '@/lib/server/domains/api/agent-auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { agentHandoffBodySchema } from '@/lib/server/domains/support-agents/agent-api.schemas'
import type { ConversationId, SupportAgentTurnId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/agent/conversations/$conversationId/handoff')({
  server: {
    handlers: {
      /** POST /api/v1/agent/conversations/:id/handoff: give the conversation to the team, with a reason and a note. */
      POST: async ({ request, params }) => {
        try {
          const agent = await withAgentAuth(request)
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const parsed = agentHandoffBodySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { assertAgentControls, handOffToTeam } =
            await import('@/lib/server/domains/support-agents/agent-actions.service')
          await assertAgentControls(agent, conversationId)
          await handOffToTeam({
            agent,
            conversationId,
            turnId: parsed.data.turnId as SupportAgentTurnId,
            reason: parsed.data.reason,
            note: parsed.data.note,
          })
          return successResponse({ handedOff: true })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
