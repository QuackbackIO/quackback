/**
 * GET  /api/v1/chat-tags — list conversation tags (with usage counts)
 * POST /api/v1/chat-tags — create a conversation tag
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  forbiddenResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'

const createBody = z.object({
  name: z.string().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
})

export const Route = createFileRoute('/api/v1/chat-tags/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.CHAT_VIEW)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.CHAT_VIEW)) {
            return forbiddenResponse('chat.view permission required')
          }
          const { listChatTagsWithCounts } =
            await import('@/lib/server/domains/chat/chat-tag.service')
          return successResponse(await listChatTagsWithCounts())
        } catch (error) {
          return handleDomainError(error)
        }
      },

      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          assertScopeAllowed(auth, PERMISSIONS.CHAT_MANAGE)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.CHAT_MANAGE)) {
            return forbiddenResponse('chat.manage permission required')
          }
          const parsed = createBody.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { createChatTag } = await import('@/lib/server/domains/chat/chat-tag.service')
          return createdResponse(await createChatTag(parsed.data))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
