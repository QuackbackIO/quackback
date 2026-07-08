/**
 * GET  /api/v1/inboxes/:inboxId/channels — list channels
 * POST /api/v1/inboxes/:inboxId/channels — add channel
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
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { addInboxChannel, listChannelsForInbox } from '@/lib/server/domains/inboxes'
import { INBOX_CHANNEL_KINDS } from '@/lib/server/db'
import type { InboxId } from '@quackback/ids'

const addSchema = z.object({
  kind: z.enum(INBOX_CHANNEL_KINDS),
  label: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()).optional(),
  externalId: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/inboxes/$inboxId/channels')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_VIEW)
          if (!hasPermission(set, PERMISSIONS.INBOX_VIEW)) {
            return forbiddenResponse('inbox.view permission required')
          }
          const id = parseTypeId<InboxId>(params.inboxId, 'inbox', 'inbox ID')
          return successResponse(await listChannelsForInbox(id))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_CHANNEL_MANAGE)
          if (!hasPermission(set, PERMISSIONS.INBOX_CHANNEL_MANAGE)) {
            return forbiddenResponse('inbox.channel.manage permission required')
          }
          const inboxId = parseTypeId<InboxId>(params.inboxId, 'inbox', 'inbox ID')
          const body = await request.json().catch(() => null)
          const parsed = addSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const channel = await addInboxChannel({ inboxId, ...parsed.data } as never)
          return createdResponse(channel)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
