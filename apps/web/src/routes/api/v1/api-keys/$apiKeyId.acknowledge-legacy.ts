/**
 * POST /api/v1/api-keys/:apiKeyId/acknowledge-legacy
 *
 * Marks the legacy "all permissions" compatibility flag as acknowledged.
 * Suppresses the warning surfaced via `compatLegacyFullAccess`; does NOT
 * change behavior — the key still grants all permissions until scopes are
 * actually set.
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

export const Route = createFileRoute('/api/v1/api-keys/$apiKeyId/acknowledge-legacy')({
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
          const { acknowledgeLegacyCompat } =
            await import('@/lib/server/domains/api-keys/api-key.service')
          const key = await acknowledgeLegacyCompat(params.apiKeyId as ApiKeyId)
          try {
            const { recordEvent } = await import('@/lib/server/domains/audit')
            await recordEvent({
              principalId: auth.principalId,
              action: 'api_key.legacy_acknowledged',
              targetType: 'api_key',
              targetId: key.id,
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
    },
  },
})
