/**
 * PATCH /api/v1/conversations/:conversationId/status — set conversation status
 * (open | pending | closed).
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
import { CONVERSATION_STATUSES } from '@/lib/server/db'
import { buildChatActor } from './-chat-actor'
import type { ConversationId } from '@quackback/ids'

const bodySchema = z.object({ status: z.enum(CONVERSATION_STATUSES) })

export const Route = createFileRoute('/api/v1/conversations/$conversationId/status')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
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
          const parsed = bodySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { setConversationStatus } = await import('@/lib/server/domains/chat/chat.service')
          const updated = await setConversationStatus(
            conversationId,
            parsed.data.status,
            buildChatActor(auth)
          )
          return successResponse({ id: updated.id, status: updated.status })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
