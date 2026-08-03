/**
 * DELETE /api/v1/conversations/:conversationId/tags/:chatTagId — detach a tag.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { ConversationId, ChatTagId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/conversations/$conversationId/tags/$chatTagId')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
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
          const chatTagId = parseTypeId<ChatTagId>(params.chatTagId, 'chat_tag', 'chat tag ID')
          const { detachTag } = await import('@/lib/server/domains/chat/chat-tag.service')
          return successResponse(await detachTag(conversationId, chatTagId))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
