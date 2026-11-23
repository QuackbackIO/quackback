/**
 * The portal-access gate for people who are not making a request: the
 * recipients of an announcement (status incident, changelog entry).
 *
 * `resolvePortalAccessForRequest` answers "may this caller see the portal?"
 * from the request's session. A fan-out has no request, so this module asks
 * the same question of each recipient, from what is stored about them, and
 * hands the answer to the same pure `evaluatePortalAccess`. Someone a private
 * portal would turn away at the door is not emailed or belled what is
 * behind it.
 *
 * Grant paths, as the request gate has them:
 *   - team: a teammate (admin or member role);
 *   - domain: a verified email on the allowed-domain list;
 *   - invite: a verified email with an accepted portal invite;
 *   - segment: a verified member of an allowed segment;
 *   - widget: widget sign-in on, and a live portal session that came from
 *     the widget handoff or a live widget session identified with a verified
 *     ssoToken.
 */
import type { PrincipalId, SegmentId } from '@quackback/ids'
import {
  db,
  and,
  eq,
  gt,
  inArray,
  invitation,
  principal,
  session,
  user,
  userSegments,
  widgetIdentifiedSession,
  widgetOriginSession,
} from '@/lib/server/db'
import { NotFoundError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { getPortalConfig } from './settings.service'
import { evaluatePortalAccess } from './portal-access'
import type { PortalConfig } from './settings.types'

const log = logger.child({ component: 'portal-access-recipients' })

/** The portal config, or null when there is no settings row yet (an
 *  un-onboarded install, which the request gate treats as public). */
async function readPortalConfig(): Promise<PortalConfig | null> {
  try {
    return await getPortalConfig()
  } catch (err) {
    if (err instanceof NotFoundError) return null
    throw err
  }
}

/**
 * The subset of `principalIds` the portal lets in. On a public portal that is
 * everyone. A private portal keeps only those with a grant. Fails closed: if
 * the policy cannot be read, nobody is let in, as the request gate does.
 */
export async function principalsWithPortalAccess(
  principalIds: readonly PrincipalId[]
): Promise<Set<PrincipalId>> {
  if (principalIds.length === 0) return new Set()

  let portalConfig: PortalConfig | null
  try {
    portalConfig = await readPortalConfig()
  } catch (err) {
    log.error({ err }, 'portal config unreadable, failing closed')
    return new Set()
  }
  if (portalConfig?.access?.visibility !== 'private') return new Set(principalIds)

  const access = portalConfig.access
  const allowedDomains = access.allowedDomains ?? []
  const allowedSegmentIds = (access.allowedSegmentIds ?? []) as SegmentId[]
  const widgetSignInEnabled = access.widgetSignIn ?? false

  const ids = [...principalIds]
  const people = await db
    .select({
      id: principal.id,
      role: principal.role,
      type: principal.type,
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
    })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, ids))

  const verifiedEmails = people.flatMap((p) =>
    p.email && p.emailVerified ? [p.email.toLowerCase()] : []
  )
  const userIds = people.flatMap((p) => (p.userId ? [p.userId] : []))

  const [invites, segmentRows, widgetRows, verifiedWidgetRows] = await Promise.all([
    verifiedEmails.length > 0
      ? db
          .select({ email: invitation.email })
          .from(invitation)
          .where(
            and(
              inArray(invitation.email, verifiedEmails),
              eq(invitation.kind, 'portal'),
              eq(invitation.status, 'accepted')
            )
          )
      : [],
    allowedSegmentIds.length > 0
      ? db
          .select({ principalId: userSegments.principalId })
          .from(userSegments)
          .where(
            and(
              inArray(userSegments.principalId, ids),
              inArray(userSegments.segmentId, allowedSegmentIds)
            )
          )
      : [],
    widgetSignInEnabled && userIds.length > 0
      ? db
          .select({ userId: widgetOriginSession.userId })
          .from(widgetOriginSession)
          .innerJoin(session, eq(session.id, widgetOriginSession.sessionId))
          .where(
            and(inArray(widgetOriginSession.userId, userIds), gt(session.expiresAt, new Date()))
          )
      : [],
    // A live widget session identified with a verified ssoToken counts too.
    widgetSignInEnabled && userIds.length > 0
      ? db
          .select({ userId: session.userId })
          .from(widgetIdentifiedSession)
          .innerJoin(session, eq(session.id, widgetIdentifiedSession.sessionId))
          .where(
            and(
              inArray(session.userId, userIds),
              eq(widgetIdentifiedSession.hmacVerified, true),
              gt(session.expiresAt, new Date())
            )
          )
      : [],
  ])
  const invitedEmails = new Set(invites.map((r) => r.email.toLowerCase()))
  const inAllowedSegment = new Set(segmentRows.map((r) => String(r.principalId)))
  const viaWidget = new Set([...widgetRows, ...verifiedWidgetRows].map((r) => r.userId))

  const granted = new Set<PrincipalId>()
  for (const p of people) {
    const isAuthenticated = p.type !== 'anonymous' && !!p.userId
    const email = p.email?.toLowerCase() ?? null
    const decision = evaluatePortalAccess({
      visibility: 'private',
      role: p.role === 'admin' || p.role === 'member' || p.role === 'user' ? p.role : null,
      isAuthenticated,
      userEmail: email,
      emailVerified: p.emailVerified ?? false,
      allowedDomains,
      hasAcceptedPortalInvite: !!email && invitedEmails.has(email),
      widgetSignInEnabled,
      hasViaWidgetMarker: !!p.userId && viaWidget.has(p.userId),
      // Widget identify is verified-only, as the request gate assumes.
      identifyVerificationEnabled: true,
      isInAllowedSegment: inAllowedSegment.has(String(p.id)),
    })
    if (decision.granted) granted.add(p.id as PrincipalId)
  }
  return granted
}
