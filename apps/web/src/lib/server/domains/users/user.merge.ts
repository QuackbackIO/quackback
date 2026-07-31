/**
 * Admin-initiated lead merge.
 *
 * The anonymous→identified merge machinery (principals/principal-repoint.ts)
 * already runs on the self-serve paths — widget identify, portal sign-in.
 * This module exposes the same merge as an admin action: from a lead's
 * profile, an admin folds the lead into an identified portal user when the
 * directory shows the same person twice (e.g. a visitor who left a contact
 * email and later signed up on another device, so the automatic merge never
 * fired).
 *
 * The rules are the registry's, unchanged: direction is strictly lead → user,
 * the user's attributes win every conflict (the lead only fills gaps), and on
 * unique-constraint collisions (both voted the same post, both subscribed)
 * the lead's row drops. Identity teardown afterwards removes the anonymous
 * principal and its synthetic user row, so the lead disappears from the
 * directory and its activity reads under the user's name.
 */

import { db, inArray, principal } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { repointPrincipalActivity } from '@/lib/server/domains/principals/principal-repoint'
import { deleteAnonymousIdentity } from '@/lib/server/domains/principals/principal.factory'
import { NotFoundError, InternalError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'users' })

/**
 * Merge a lead (anonymous principal) into an identified portal user.
 *
 * Re-points every piece of the lead's activity onto the user's principal and
 * deletes the anonymous identity, in one transaction. Throws NotFoundError
 * unless the source is an anonymous principal and the target is an identified
 * (type='user') portal user — the only direction the re-point registry
 * supports.
 */
export async function mergeLeadIntoUser(
  leadPrincipalId: PrincipalId,
  targetPrincipalId: PrincipalId
): Promise<void> {
  if (leadPrincipalId === targetPrincipalId) {
    throw new NotFoundError('MEMBER_NOT_FOUND', 'A lead cannot be merged into itself')
  }

  try {
    const rows = await db
      .select({
        id: principal.id,
        userId: principal.userId,
        type: principal.type,
        role: principal.role,
        displayName: principal.displayName,
      })
      .from(principal)
      .where(inArray(principal.id, [leadPrincipalId, targetPrincipalId]))

    const lead = rows.find((r) => r.id === leadPrincipalId)
    const target = rows.find((r) => r.id === targetPrincipalId)

    if (!lead || lead.type !== 'anonymous' || !lead.userId) {
      throw new NotFoundError(
        'MEMBER_NOT_FOUND',
        `Lead with principal ID ${leadPrincipalId} not found`
      )
    }
    // The target must be an identified portal user: the re-point registry's
    // collision rules assume the identified side keeps its rows, and merging a
    // customer into a teammate would re-home portal activity on a staff
    // identity.
    if (!target || target.type !== 'user' || target.role !== 'user') {
      throw new NotFoundError(
        'MEMBER_NOT_FOUND',
        `Portal user with principal ID ${targetPrincipalId} not found`
      )
    }

    await db.transaction(async (tx) => {
      await repointPrincipalActivity(tx, leadPrincipalId, targetPrincipalId, {
        displayNames: {
          from: lead.displayName || 'Anonymous',
          to: target.displayName || 'User',
        },
      })
      await deleteAnonymousIdentity({ principalId: leadPrincipalId, userId: lead.userId! }, tx)
    })

    log.info(
      { lead_principal_id: leadPrincipalId, target_principal_id: targetPrincipalId },
      'lead merged into portal user'
    )
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    log.error({ err: error, leadPrincipalId, targetPrincipalId }, 'failed to merge lead into user')
    throw new InternalError('DATABASE_ERROR', 'Failed to merge lead into user', error)
  }
}
