/**
 * Resolve a previousToken from the widget and merge anonymous activity
 * into the newly identified user.
 *
 * Called by the widget identify endpoint when the client sends a
 * previousToken alongside the new identify payload. This enables
 * anonymous→identified transitions to preserve votes, comments, and posts.
 */
import type { PrincipalId, UserId } from '@quackback/ids'
import { db, session, principal, eq, and, gt } from '@/lib/server/db'
import { mergeAnonymousToIdentified } from './merge-anonymous'

interface ResolveAndMergeParams {
  /** The previous widget session token (captured before re-identify) */
  previousToken: string | null | undefined
  /** The principal ID of the newly identified user */
  targetPrincipalId: PrincipalId
  /** Display name of the newly identified user */
  targetDisplayName: string
}

/**
 * Validates the previous token, checks that it belongs to an anonymous user,
 * and merges their activity into the target principal. Non-fatal on failure.
 */
export async function resolveAndMergeAnonymousToken(params: ResolveAndMergeParams): Promise<void> {
  const { previousToken, targetPrincipalId, targetDisplayName } = params

  if (!previousToken) return

  try {
    // Look up the session for the previous token
    const prevSession = await db.query.session.findFirst({
      where: and(eq(session.token, previousToken), gt(session.expiresAt, new Date())),
      with: { user: true },
    })
    if (!prevSession) return

    const prevUserId = prevSession.userId as UserId

    // Check that the previous session belongs to an anonymous user
    const prevPrincipal = await db.query.principal.findFirst({
      where: eq(principal.userId, prevUserId),
    })
    if (!prevPrincipal) return
    if (prevPrincipal.type !== 'anonymous') return

    // Don't merge with self
    if (prevPrincipal.id === targetPrincipalId) return

    await mergeAnonymousToIdentified({
      anonPrincipalId: prevPrincipal.id as PrincipalId,
      targetPrincipalId,
      anonUserId: prevUserId,
      anonDisplayName: prevPrincipal.displayName || 'Anonymous',
      targetDisplayName,
    })
  } catch (error) {
    // Merge failures are non-fatal — the identify should still succeed
    console.error('[widget-identify] previousToken merge failed:', error)
  }
}
