/**
 * The REST face of the portal design: how an API key becomes the person a
 * draft is written for, and how a refusal becomes a status.
 *
 * A key reads the design and edits the draft. Publishing and restoring stay
 * with a person in Settings › Portal, where the draft shows what is waiting.
 */
import type { PrincipalId } from '@quackback/ids'
import { db, eq, principal, user } from '@/lib/server/db'
import { assertApiPermissions, type ApiAuthContext } from '@/lib/server/domains/api/auth'
import { errorResponse } from '@/lib/server/domains/api/responses'
import { assertSettingsScope } from '@/lib/server/domains/settings-registry/http'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { DesignRefusal, DesignRefusalCode } from './design.actions'
import type { DesignAuthor } from './design.service'

const REFUSAL_STATUS: Record<DesignRefusalCode, number> = {
  INVALID_DESIGN: 400,
  UNREADABLE_DESIGN: 400,
  REVISION_MISMATCH: 412,
  DESIGN_CHANGED: 409,
  DRAFT_CHANGED: 409,
  NO_DRAFT: 404,
  REVISION_NOT_FOUND: 404,
  INVALID_CSS: 400,
  TIER_LIMIT_EXCEEDED: 403,
  NOT_SWITCHABLE: 409,
  NOT_SWITCHED: 409,
}

/** The key needs the settings scope and its owner the branding permission. */
export function assertDesignAccess(
  auth: ApiAuthContext,
  scope: 'read:settings' | 'write:settings'
) {
  assertSettingsScope(auth, scope)
  assertApiPermissions(auth, [PERMISSIONS.SETTINGS_BRANDING])
}

/** A key writes for the teammate who created it. */
export async function designAuthorFromApiAuth(
  auth: ApiAuthContext,
  headers: Headers
): Promise<DesignAuthor> {
  const principalId = (auth.apiKey.createdById ?? auth.principalId) as PrincipalId
  const [person] = await db
    .select({ userId: principal.userId, email: user.email })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(eq(principal.id, principalId))
    .limit(1)
  return {
    principalId,
    actor: {
      userId: person?.userId ?? undefined,
      email: person?.email ?? undefined,
      role: auth.role,
      type: 'user',
    },
    headers,
  }
}

export function refusalResponse(refusal: DesignRefusal): Response {
  return errorResponse(refusal.code, refusal.message, REFUSAL_STATUS[refusal.code])
}
