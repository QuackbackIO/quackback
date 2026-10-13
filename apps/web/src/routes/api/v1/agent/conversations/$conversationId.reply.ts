import { createFileRoute } from '@tanstack/react-router'
import { withAgentAuth } from '@/lib/server/domains/api/agent-auth'
import {
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { agentReplyBodySchema } from '@/lib/server/domains/support-agents/agent-api.schemas'
import { markdownToSanitizedJson } from '../../-write-validation'
import type { ConversationId, SupportAgentTurnId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/agent/conversations/$conversationId/reply')({
  server: {
    handlers: {
      /** POST /api/v1/agent/conversations/:id/reply: answer an open turn, shown to the customer as AI. */
      POST: async ({ request, params }) => {
        try {
          const agent = await withAgentAuth(request)
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const parsed = agentReplyBodySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const turnId = parseTypeId<SupportAgentTurnId>(
            parsed.data.turnId,
            'support_agent_turn',
            'turn ID'
          )
          const { postAgentReply } =
            await import('@/lib/server/domains/support-agents/agent-actions.service')
          const result = await postAgentReply({
            agent,
            conversationId,
            turnId,
            content: parsed.data.content,
            contentJson: markdownToSanitizedJson(parsed.data.content),
            citations: parsed.data.citations?.map((c) => ({
              type: 'webpage' as const,
              id: c.url,
              title: c.title,
              url: c.url,
            })),
            idempotencyKey: parsed.data.idempotencyKey,
          })
          return createdResponse({
            messageId: result.messageId,
            turnId,
            createdAt: result.createdAt,
            replayed: result.replayed,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
