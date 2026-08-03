/**
 * GET    /api/v1/api-keys/:apiKeyId — fetch a key
 * PATCH  /api/v1/api-keys/:apiKeyId — update name/scopes/teams/inboxes
 * DELETE /api/v1/api-keys/:apiKeyId — revoke (soft delete)
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
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { ApiKeyId } from '@/lib/server/domains/api-keys'

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  scopes: z.array(z.string().min(1).max(128)).max(64).optional(),
  allowedTeamIds: z.array(z.string().min(1).max(64)).max(256).optional(),
  allowedInboxIds: z.array(z.string().min(1).max(64)).max(256).optional(),
})

async function ensureManageScope(request: Request) {
  const auth = await withApiKeyAuth(request, { role: 'admin' })
  assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_API_KEYS)
  const set = await loadPermissionSet(auth.principalId)
  assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_API_KEYS)
  if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_API_KEYS)) {
    return { auth, denied: forbiddenResponse('admin.manage_api_keys permission required') }
  }
  return { auth, denied: null as Response | null }
}

export const Route = createFileRoute('/api/v1/api-keys/$apiKeyId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { auth, denied } = await ensureManageScope(request)
          if (denied) return denied
          void auth
          const { getApiKeyById } = await import('@/lib/server/domains/api-keys/api-key.service')
          return successResponse(await getApiKeyById(params.apiKeyId as ApiKeyId))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const { auth, denied } = await ensureManageScope(request)
          if (denied) return denied
          const body = await request.json().catch(() => null)
          const parsed = patchSchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', { issues: parsed.error.issues })
          }
          const { updateApiKey, getApiKeyById } =
            await import('@/lib/server/domains/api-keys/api-key.service')
          const before = await getApiKeyById(params.apiKeyId as ApiKeyId)
          const key = await updateApiKey(params.apiKeyId as ApiKeyId, parsed.data)
          try {
            const { recordEvent } = await import('@/lib/server/domains/audit')
            await recordEvent({
              principalId: auth.principalId,
              action: 'api_key.updated',
              targetType: 'api_key',
              targetId: key.id,
              diff: {
                before: {
                  name: before.name,
                  scopes: before.scopes,
                  allowedTeamIds: before.allowedTeamIds,
                  allowedInboxIds: before.allowedInboxIds,
                },
                after: {
                  name: key.name,
                  scopes: key.scopes,
                  allowedTeamIds: key.allowedTeamIds,
                  allowedInboxIds: key.allowedInboxIds,
                },
              },
              source: auth.source,
              ipAddress: auth.ipAddress,
              userAgent: auth.userAgent,
            })
          } catch (e) {
            console.warn('[api/v1/api-keys] audit failed:', e)
          }
          return successResponse(key)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const { auth, denied } = await ensureManageScope(request)
          if (denied) return denied
          const { revokeApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
          await revokeApiKey(params.apiKeyId as ApiKeyId)
          try {
            const { recordEvent } = await import('@/lib/server/domains/audit')
            await recordEvent({
              principalId: auth.principalId,
              action: 'api_key.revoked',
              targetType: 'api_key',
              targetId: params.apiKeyId,
              source: auth.source,
              ipAddress: auth.ipAddress,
              userAgent: auth.userAgent,
            })
          } catch (e) {
            console.warn('[api/v1/api-keys] audit failed:', e)
          }
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
