import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializeMessage } from './-serialize'
import {
  messageContentSchema,
  attachmentsSchema,
  toAttachments,
  markdownToSanitizedJson,
} from './-validation'
import type { ConversationId } from '@quackback/ids'

const replySchema = z.object({
  content: messageContentSchema,
  attachments: attachmentsSchema,
})

export const Route = createFileRoute('/api/v1/conversations/$conversationId/reply')({
  server: {
    handlers: {
      /** POST /api/v1/conversations/:id/reply — agent reply (visible to the visitor).
       *  Verbatim send: no inbox translation layer (D7). */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.CONVERSATION_REPLY })
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )

          const parsed = replySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const agent = {
            principalId: auth.principalId,
            displayName: auth.principal?.displayName ?? 'API',
            email: auth.principal?.user?.email ?? null,
          }
          const contentJson = markdownToSanitizedJson(parsed.data.content)

          const { sendAgentMessage } =
            await import('@/lib/server/domains/conversation/conversation.service')
          // sendAgentMessage(conversationId, rawContent, agent, actor, rawAttachments?, contentJson?)
          const result = await sendAgentMessage(
            conversationId,
            parsed.data.content,
            agent,
            actor,
            toAttachments(parsed.data.attachments),
            contentJson
          )

          return createdResponse(serializeMessage(result.message))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
