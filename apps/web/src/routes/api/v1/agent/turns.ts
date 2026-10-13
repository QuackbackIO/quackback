import { createFileRoute } from '@tanstack/react-router'
import { withAgentAuth } from '@/lib/server/domains/api/agent-auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'

/** Local agents can pull current work without exposing an inbound endpoint. */
export const Route = createFileRoute('/api/v1/agent/turns')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const agent = await withAgentAuth(request)
          const { db, supportAgentTurns, conversations, eq, and, gt, asc } =
            await import('@/lib/server/db')
          const turns = await db
            .select({ turn: supportAgentTurns })
            .from(supportAgentTurns)
            .innerJoin(conversations, eq(conversations.id, supportAgentTurns.conversationId))
            .where(
              and(
                eq(supportAgentTurns.agentId, agent.id),
                eq(supportAgentTurns.status, 'requested'),
                gt(supportAgentTurns.deadlineAt, new Date()),
                eq(conversations.controllerAgentId, agent.id),
                eq(conversations.status, 'open')
              )
            )
            .orderBy(asc(supportAgentTurns.createdAt))
            .limit(25)
          const { loadRequestedAgentTurnContext } =
            await import('@/lib/server/domains/support-agents/agent-context')
          const data = await Promise.all(
            turns.map(async ({ turn }) => {
              try {
                return {
                  turnId: turn.id,
                  deadlineAt: turn.deadlineAt.toISOString(),
                  context: await loadRequestedAgentTurnContext(agent, turn),
                }
              } catch (error) {
                // A turn can expire or be taken over while its thread is read.
                if (error instanceof ConflictError || error instanceof NotFoundError) return null
                throw error
              }
            })
          )
          return successResponse({ turns: data.filter((turn) => turn !== null) })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
