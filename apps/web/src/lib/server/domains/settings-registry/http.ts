/**
 * The REST face of the settings registry: how an API key becomes the caller
 * the registry acts for, and how a registry result becomes a response.
 *
 * Kept out of the route files so the three settings routes share one scope
 * rule, one actor and one set of headers.
 */
import { assertApiPermissions, type ApiAuthContext } from '@/lib/server/domains/api/auth'
import { SETTINGS_AREA_META } from '@/lib/shared/settings-registry'
import { ForbiddenError } from '@/lib/shared/errors'
import { hasApiScope } from '@/lib/server/domains/api-keys/api-key-scopes'
import type { SettingsCaller } from './service'
import type { ChangeSettingsResult } from './service'
import type { UndoSettingsOutcome } from './undo'
import { successResponse } from '@/lib/server/domains/api/responses'

/**
 * `read:settings` and `write:settings` mean the registry's areas, whatever
 * permission an area needs: the permission still gates each area in the
 * registry, the scope gates the key.
 */
export function assertSettingsScope(
  auth: ApiAuthContext,
  scope: 'read:settings' | 'write:settings'
) {
  if (!hasApiScope(auth.apiKey.scopes, scope))
    throw new ForbiddenError('FORBIDDEN', `This API key is missing the '${scope}' scope`)
}

/**
 * A key acts for the teammate who created it, with the authority the REST API
 * resolved for the key. The audit row of a change names the key.
 */
export function settingsCallerFromApiAuth(auth: ApiAuthContext): SettingsCaller {
  const owner = auth.apiKey.createdById ?? auth.principalId
  return {
    // A scoped key also needs the scope its area's permission maps to.
    assertAreaScope: (area) => assertApiPermissions(auth, [SETTINGS_AREA_META[area].permission]),
    actor: {
      principalId: owner,
      role: auth.role,
      principalType: 'user',
      segmentIds: new Set(),
      permissions: auth.permissions,
    },
  }
}

/** A revision as an entity tag. */
export function etag(revision: string): string {
  return `"${revision}"`
}

/** The response to a change. */
export function changeResponse(result: ChangeSettingsResult): Response {
  switch (result.status) {
    case 'applied':
      return withEtag(
        successResponse({ status: result.status, receipt: result.receipt }),
        result.receipt.revision
      )
    case 'dry_run':
      return withEtag(
        successResponse({ status: result.status, ...result.preview }),
        result.preview.revision
      )
    case 'noop':
      return withEtag(successResponse({ status: result.status }), result.revision)
  }
}

export function withEtag(response: Response, revision: string): Response {
  response.headers.set('ETag', etag(revision))
  return response
}

/** The response to an undo. */
export function undoResponse(outcome: UndoSettingsOutcome): Response {
  return successResponse(outcome.result)
}
