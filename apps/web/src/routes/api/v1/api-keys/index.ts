/**
 * GET  /api/v1/api-keys — list keys
 * POST /api/v1/api-keys — create new key (returns plaintext once)
 *
 * Both require API key with `admin.manage_api_keys` scope.
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

const createSchema = z.object({
  name: z.string().min(1).max(255),
  expiresAt: z.string().datetime().nullish(),
  scopes: z.array(z.string().min(1).max(128)).max(64).optional(),
  allowedTeamIds: z.array(z.string().min(1).max(64)).max(256).optional(),
  allowedInboxIds: z.array(z.string().min(1).max(64)).max(256).optional(),
})

export const Route = createFileRoute('/api/v1/api-keys/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'admin' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_API_KEYS)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_API_KEYS)) {
            return forbiddenResponse('admin.manage_api_keys permission required')
          }
          const { listApiKeys } = await import('@/lib/server/domains/api-keys/api-key.service')
          return successResponse(await listApiKeys())
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'admin' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_API_KEYS)
          const set = await loadPermissionSet(auth.principalId)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_API_KEYS)) {
            return forbiddenResponse('admin.manage_api_keys permission required')
          }
          const body = await request.json().catch(() => null)
          const parsed = createSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const { createApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
          const result = await createApiKey(
            {
              name: parsed.data.name,
              expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
              scopes: parsed.data.scopes,
              allowedTeamIds: parsed.data.allowedTeamIds,
              allowedInboxIds: parsed.data.allowedInboxIds,
            },
            auth.principalId
          )
          try {
            const { recordEvent } = await import('@/lib/server/domains/audit')
            await recordEvent({
              principalId: auth.principalId,
              action: 'api_key.created',
              targetType: 'api_key',
              targetId: result.apiKey.id,
              diff: {
                after: {
                  name: result.apiKey.name,
                  keyPrefix: result.apiKey.keyPrefix,
                  scopes: result.apiKey.scopes,
                  allowedTeamIds: result.apiKey.allowedTeamIds,
                  allowedInboxIds: result.apiKey.allowedInboxIds,
                },
              },
              source: auth.source,
              ipAddress: auth.ipAddress,
              userAgent: auth.userAgent,
            })
          } catch (e) {
            console.warn('[api/v1/api-keys] audit failed:', e)
          }
          return createdResponse(result)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
