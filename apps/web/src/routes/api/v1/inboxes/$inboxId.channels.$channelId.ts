/**
 * PATCH  /api/v1/inboxes/:inboxId/channels/:channelId
 * DELETE /api/v1/inboxes/:inboxId/channels/:channelId — archive
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  badRequestResponse,
  noContentResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { archiveInboxChannel, updateInboxChannel } from '@/lib/server/domains/inboxes'
import type { InboxChannelId } from '@quackback/ids'

const patchSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  externalId: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/inboxes/$inboxId/channels/$channelId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_CHANNEL_MANAGE)
          if (!hasPermission(set, PERMISSIONS.INBOX_CHANNEL_MANAGE)) {
            return forbiddenResponse('inbox.channel.manage permission required')
          }
          const id = parseTypeId<InboxChannelId>(params.channelId, 'inbox_ch', 'channel ID')
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          return successResponse(await updateInboxChannel(id, parsed.data as never))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.INBOX_CHANNEL_MANAGE)
          if (!hasPermission(set, PERMISSIONS.INBOX_CHANNEL_MANAGE)) {
            return forbiddenResponse('inbox.channel.manage permission required')
          }
          const id = parseTypeId<InboxChannelId>(params.channelId, 'inbox_ch', 'channel ID')
          await archiveInboxChannel(id)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
