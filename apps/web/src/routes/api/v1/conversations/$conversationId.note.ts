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

const noteSchema = z.object({
  content: messageContentSchema,
  attachments: attachmentsSchema,
})

export const Route = createFileRoute('/api/v1/conversations/$conversationId/note')({
  server: {
    handlers: {
      /** POST /api/v1/conversations/:id/note — agent-only internal note (never reaches the visitor). */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.CONVERSATION_NOTE })
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )

          const parsed = noteSchema.safeParse(await request.json().catch(() => null))
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

          const { addAgentNote } =
            await import('@/lib/server/domains/conversation/conversation.service')
          // Signature footgun: addAgentNote(conversationId, rawContent, agent, actor, contentJson?, attachments?)
          // — attachments/contentJson are the OPPOSITE order from sendAgentMessage.
          const result = await addAgentNote(
            conversationId,
            parsed.data.content,
            agent,
            actor,
            contentJson,
            toAttachments(parsed.data.attachments)
          )

          return createdResponse(serializeMessage(result.message))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
