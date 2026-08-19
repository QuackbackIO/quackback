/**
 * Orchestration for the two anonymous merge paths. The table-by-table work
 * lives in the principal re-point registry (domains/principals/
 * principal-repoint.ts, enforced complete by its schema-walking test) and
 * identity teardown in the principal factory; this module only sequences them
 * inside one transaction.
 *
 * Paths:
 * - mergeAnonymousToIdentified: the anonymous principal's activity moves onto
 *   an existing identified principal, then the anonymous identity is deleted.
 *   Used by portal sign-in to an existing account (onLinkAccount) and the
 *   widget identify previousToken merge.
 * - absorbSignupIntoAnonymous: a brand-new signup is absorbed INTO the
 *   anonymous user, which keeps its sessions/principal/activity and takes on
 *   the real identity. Used by onLinkAccount when the link target is a fresh
 *   account.
 */
import type { PrincipalId, UserId } from '@quackback/ids'
import { db, account, session, user, eq } from '@/lib/server/db'
import { repointPrincipalActivity } from '@/lib/server/domains/principals/principal-repoint'
import {
  deleteAnonymousIdentity,
  updatePrincipalFields,
} from '@/lib/server/domains/principals/principal.factory'

export interface MergeAnonymousParams {
  /** The anonymous principal being merged FROM */
  anonPrincipalId: PrincipalId
  /** The identified principal being merged INTO */
  targetPrincipalId: PrincipalId
  /** The anonymous user ID (for session/user cleanup) */
  anonUserId: UserId
  /** Display name of the anonymous user (for notification title fixup) */
  anonDisplayName: string
  /** Display name of the target user (for notification title fixup) */
  targetDisplayName: string
}

export async function mergeAnonymousToIdentified(params: MergeAnonymousParams): Promise<void> {
  const { anonPrincipalId, targetPrincipalId, anonUserId, anonDisplayName, targetDisplayName } =
    params

  await db.transaction(async (tx) => {
    await repointPrincipalActivity(tx, anonPrincipalId, targetPrincipalId, {
      displayNames: { from: anonDisplayName || 'Anonymous', to: targetDisplayName },
    })
    await deleteAnonymousIdentity({ principalId: anonPrincipalId, userId: anonUserId }, tx)
  })
}

export interface AbsorbSignupParams {
  /** The anonymous user being kept (its sessions, principal, and activity survive). */
  anonUserId: UserId
  anonPrincipalId: PrincipalId | null
  /** The freshly created signup user being absorbed and deleted. */
  newUserId: UserId
  newUserPrincipalId: PrincipalId | null
  /** Real identity stamped onto the surviving (previously anonymous) user. */
  name: string
  email: string
  image: string | null
  /** Display name for the upgraded principal. */
  displayName: string
}

/**
 * SIGN-UP absorb: keep the anonymous user, absorb the new user into it. This
 * preserves sessions, principal, votes, comments on the same userId. Returns
 * the principal-cache keys for the caller to bust after commit (the
 * principal's type flips from 'anonymous' to 'user').
 */
export async function absorbSignupIntoAnonymous(
  params: AbsorbSignupParams
): Promise<{ cacheKeysToBust: readonly string[] }> {
  const { anonUserId, anonPrincipalId, newUserId, newUserPrincipalId } = params

  let cacheKeysToBust: readonly string[] = []
  await db.transaction(async (tx) => {
    // Move account+session refs to the anon user (before deleting the new user)
    await Promise.all([
      tx.update(account).set({ userId: anonUserId }).where(eq(account.userId, newUserId)),
      tx.update(session).set({ userId: anonUserId }).where(eq(session.userId, newUserId)),
    ])

    // The signup principal normally has no activity, but anything it did
    // acquire follows the surviving principal via the same registry as the
    // sign-in merge.
    if (newUserPrincipalId && anonPrincipalId) {
      await repointPrincipalActivity(tx, newUserPrincipalId, anonPrincipalId)
    }

    // Delete the new identity (frees the email for the anon user update)
    await deleteAnonymousIdentity({ principalId: newUserPrincipalId, userId: newUserId }, tx)

    // Update the anon user with the real identity + upgrade the principal
    const [, fieldResult] = await Promise.all([
      tx
        .update(user)
        .set({
          name: params.name,
          email: params.email,
          emailVerified: true,
          isAnonymous: false,
          image: params.image,
        })
        .where(eq(user.id, anonUserId)),
      updatePrincipalFields(
        { userId: anonUserId },
        { type: 'user', displayName: params.displayName, avatarUrl: params.image },
        { executor: tx }
      ),
    ])
    cacheKeysToBust = fieldResult.cacheKeysToBust
  })

  return { cacheKeysToBust }
}
