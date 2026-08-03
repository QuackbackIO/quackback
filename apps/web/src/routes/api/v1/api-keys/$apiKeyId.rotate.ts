/**
 * POST /api/v1/api-keys/:apiKeyId/rotate — generate a new key value.
 * Returns the new plaintext key once; old value stops working immediately.
 */
import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  forbiddenResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { hasPermission, loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { ApiKeyId } from '@/lib/server/domains/api-keys'

export const Route = createFileRoute('/api/v1/api-keys/$apiKeyId/rotate')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'admin' })
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_API_KEYS)
          const set = await loadPermissionSet(auth.principalId)
          assertScopeAllowed(auth, PERMISSIONS.ADMIN_MANAGE_API_KEYS)
          if (!hasPermission(set, PERMISSIONS.ADMIN_MANAGE_API_KEYS)) {
            return forbiddenResponse('admin.manage_api_keys permission required')
          }
          const { rotateApiKey, getApiKeyById } =
            await import('@/lib/server/domains/api-keys/api-key.service')
          const before = await getApiKeyById(params.apiKeyId as ApiKeyId)
          const result = await rotateApiKey(params.apiKeyId as ApiKeyId)
          try {
            const { recordEvent } = await import('@/lib/server/domains/audit')
            await recordEvent({
              principalId: auth.principalId,
              action: 'api_key.rotated',
              targetType: 'api_key',
              targetId: result.apiKey.id,
              diff: {
                before: { keyPrefix: before.keyPrefix },
                after: { keyPrefix: result.apiKey.keyPrefix },
              },
              source: auth.source,
              ipAddress: auth.ipAddress,
              userAgent: auth.userAgent,
            })
          } catch (e) {
            console.warn('[api/v1/api-keys] audit failed:', e)
          }
          return successResponse(result)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
