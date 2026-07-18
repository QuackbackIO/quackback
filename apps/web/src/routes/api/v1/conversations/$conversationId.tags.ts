import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { z as zType } from 'zod'
import type { ConversationId, ConversationTagId } from '@quackback/ids'

const tagSchema = z.object({
  tagId: z.string().min(1),
})

type TagRequest =
  | { ok: true; conversationId: ConversationId; tagId: ConversationTagId }
  | { ok: false; error: zType.ZodError }

async function parseTagRequest(request: Request, conversationIdRaw: string): Promise<TagRequest> {
  const conversationId = parseTypeId<ConversationId>(
    conversationIdRaw,
    'conversation',
    'conversation ID'
  )
  const parsed = tagSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return { ok: false, error: parsed.error }
  }
  const tagId = parseTypeId<ConversationTagId>(parsed.data.tagId, 'conversation_tag', 'tag ID')
  return { ok: true, conversationId, tagId }
}

export const Route = createFileRoute('/api/v1/conversations/$conversationId/tags')({
  server: {
    handlers: {
      /** POST /api/v1/conversations/:id/tags — attach an existing tag (idempotent). */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.CONVERSATION_SET_TAGS,
          })
          const result = await parseTagRequest(request, params.conversationId)
          if (!result.ok) {
            return badRequestResponse('Invalid request body', {
              errors: result.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const { assertConversationViewable } =
            await import('@/lib/server/domains/conversation/conversation.service')
          const { attachTag } =
            await import('@/lib/server/domains/conversation/conversation-tag.service')

          // The tag service is deliberately ungated and does no existence check;
          // assert the conversation is real+viewable first so an attach on a
          // missing conversation is a 404, not an FK-violation 500.
          await assertConversationViewable(result.conversationId, actor)
          const tags = await attachTag(result.conversationId, result.tagId)

          return successResponse(tags)
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /** DELETE /api/v1/conversations/:id/tags — detach a tag. */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.CONVERSATION_SET_TAGS,
          })
          const result = await parseTagRequest(request, params.conversationId)
          if (!result.ok) {
            return badRequestResponse('Invalid request body', {
              errors: result.error.flatten().fieldErrors,
            })
          }

          const actor = serviceActorFromApiAuth(auth)
          const { assertConversationViewable } =
            await import('@/lib/server/domains/conversation/conversation.service')
          const { detachTag } =
            await import('@/lib/server/domains/conversation/conversation-tag.service')

          // Without the viewable assert, detach on a nonexistent conversation
          // returns a misleading 200 — assert existence first so it's a 404.
          await assertConversationViewable(result.conversationId, actor)
          const tags = await detachTag(result.conversationId, result.tagId)

          return successResponse(tags)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
