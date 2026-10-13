import { createFileRoute } from '@tanstack/react-router'
import { withAgentAuth } from '@/lib/server/domains/api/agent-auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { ConversationId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/agent/conversations/$conversationId')({
  server: {
    handlers: {
      /** GET /api/v1/agent/conversations/:id: the thread and customer, for a conversation the agent controls. */
      GET: async ({ request, params }) => {
        try {
          const agent = await withAgentAuth(request)
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const { loadControlledAgentContext } =
            await import('@/lib/server/domains/support-agents/agent-context')
          return successResponse(await loadControlledAgentContext(agent, conversationId))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
