/**
 * GET  /api/v1/conversations/:conversationId/tags — list tags on a conversation
 * POST /api/v1/conversations/:conversationId/tags — attach a tag { chatTagId }
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { ConversationId, ChatTagId } from '@quackback/ids'

const attachBody = z.object({ chatTagId: z.string().min(1) })

export const Route = createFileRoute('/api/v1/conversations/$conversationId/tags')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.CHAT_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.CHAT_VIEW)) {
            return forbiddenResponse('chat.view permission required')
          }
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const { listTagsForConversation } =
            await import('@/lib/server/domains/chat/chat-tag.service')
          return successResponse(await listTagsForConversation(conversationId))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.CHAT_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.CHAT_MANAGE)) {
            return forbiddenResponse('chat.manage permission required')
          }
          const conversationId = parseTypeId<ConversationId>(
            params.conversationId,
            'conversation',
            'conversation ID'
          )
          const parsed = attachBody.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const chatTagId = parseTypeId<ChatTagId>(parsed.data.chatTagId, 'chat_tag', 'chat tag ID')
          const { attachTag } = await import('@/lib/server/domains/chat/chat-tag.service')
          return successResponse(await attachTag(conversationId, chatTagId))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
