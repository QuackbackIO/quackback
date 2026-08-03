/**
 * Support-surface gates. `isLiveChatEnabled` (settings.widget.ts) keeps gating
 * the widget chat surface; these compose it with the portal Support tab so the
 * shared conversation paths (visitor send/read, SSE stream, inbound email)
 * stay alive when either surface is on.
 */
import type { PrincipalId, SegmentId, UserId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import type { SupportAccessConfig } from './settings.types'
import { DEFAULT_PORTAL_SUPPORT_ACCESS, DEFAULT_WIDGET_SUPPORT_ACCESS } from './settings.types'

export type SupportSurface = 'widget' | 'portal'

export type SupportAccessDecision =
  | { granted: true; reason: 'team' | 'anonymous' | 'authenticated' | 'selected' }
  | { granted: false; reason: 'disabled' | 'unauthenticated' | 'unauthorized' }

function normalizeSupportAccessConfig(
  value: Partial<SupportAccessConfig> | null | undefined,
  fallback: SupportAccessConfig,
  options?: { allowAnonymous?: boolean }
): SupportAccessConfig {
  const mode =
    value?.mode === 'anonymous' ||
    value?.mode === 'authenticated' ||
    value?.mode === 'selected' ||
    value?.mode === 'team'
      ? value.mode
      : fallback.mode
  return {
    mode: mode === 'anonymous' && options?.allowAnonymous === false ? fallback.mode : mode,
    segmentIds: Array.isArray(value?.segmentIds) ? (value.segmentIds as SegmentId[]) : [],
    principalIds: Array.isArray(value?.principalIds) ? (value.principalIds as PrincipalId[]) : [],
  }
}

/**
 * Whether the portal Support tab is enabled: the experimental `supportInbox`
 * feature flag AND the explicit portal toggle. Fail-closed — an absent
 * `support` section means disabled, so existing workspaces are unaffected.
 */
export async function isPortalSupportEnabled(): Promise<boolean> {
  const { isFeatureEnabled, getPortalConfig } = await import('./settings.service')
  const [flagOn, portal] = await Promise.all([isFeatureEnabled('supportInbox'), getPortalConfig()])
  return Boolean(flagOn && portal.support?.enabled === true)
}

/**
 * Whether conversations are reachable from ANY visitor surface (widget chat or
 * portal Support tab). The shared visitor-facing chat paths gate on this, so
 * disabling the widget no longer kills the portal surface and vice versa.
 */
export async function isConversationsEnabled(): Promise<boolean> {
  const { isLiveChatEnabled } = await import('./settings.widget')
  const [widget, portal] = await Promise.all([isLiveChatEnabled(), isPortalSupportEnabled()])
  return widget || portal
}

export async function isSupportSurfaceEnabled(surface: SupportSurface): Promise<boolean> {
  if (surface === 'portal') return isPortalSupportEnabled()
  const { isLiveChatEnabled } = await import('./settings.widget')
  return isLiveChatEnabled()
}

export async function getWidgetSupportAccessConfig(): Promise<SupportAccessConfig> {
  const { getLiveChatConfig } = await import('./settings.widget')
  const chat = await getLiveChatConfig()
  return normalizeSupportAccessConfig(chat.access, DEFAULT_WIDGET_SUPPORT_ACCESS, {
    allowAnonymous: true,
  })
}

export async function getPortalSupportAccessConfig(): Promise<SupportAccessConfig> {
  const { getPortalConfig } = await import('./settings.service')
  const portal = await getPortalConfig()
  return normalizeSupportAccessConfig(portal.support?.access, DEFAULT_PORTAL_SUPPORT_ACCESS, {
    allowAnonymous: false,
  })
}

async function actorForCurrentRequest(): Promise<Actor> {
  const [{ auth }, { db, principal, eq }, { getRequestHeaders }] = await Promise.all([
    import('@/lib/server/auth/index'),
    import('@/lib/server/db'),
    import('@tanstack/react-start/server'),
  ])
  const headers = getRequestHeaders()
  const anonymousActor: Actor = {
    principalId: null,
    role: null,
    principalType: 'anonymous',
    segmentIds: new Set(),
  }

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null
  try {
    session = await auth.api.getSession({ headers })
  } catch {
    return anonymousActor
  }

  if (!session?.user) {
    return anonymousActor
  }

  let row:
    | {
        id: PrincipalId
        role: string | null
        type: string
      }
    | undefined
  try {
    row = await db.query.principal.findFirst({
      where: eq(principal.userId, session.user.id as UserId),
      columns: { id: true, role: true, type: true },
    })
  } catch {
    row = undefined
  }

  if (!row || row.type === 'anonymous') {
    return anonymousActor
  }

  let segmentIds: ReadonlySet<SegmentId> = new Set()
  if (row.type === 'user') {
    try {
      const { segmentIdsForPrincipal } =
        await import('@/lib/server/domains/segments/segment-membership.service')
      segmentIds = await segmentIdsForPrincipal(row.id)
    } catch {
      segmentIds = new Set()
    }
  }

  return {
    principalId: row.id,
    role: (row.role as Actor['role']) ?? null,
    principalType: row.type === 'service' ? 'service' : 'user',
    segmentIds,
  }
}

export async function evaluateSupportAccessForRequest(
  surface: SupportSurface
): Promise<SupportAccessDecision> {
  return evaluateSupportAccessForActor(surface, await actorForCurrentRequest())
}

export async function evaluateSupportAccessForActor(
  surface: SupportSurface,
  actor: Actor
): Promise<SupportAccessDecision> {
  if (!(await isSupportSurfaceEnabled(surface))) {
    return { granted: false, reason: 'disabled' }
  }

  const [{ canAccessSupportSurface, isTeamActor }, access] = await Promise.all([
    import('@/lib/server/policy'),
    surface === 'portal' ? getPortalSupportAccessConfig() : getWidgetSupportAccessConfig(),
  ])

  const decision = canAccessSupportSurface(actor, access)
  if (decision.allowed) {
    if (isTeamActor(actor)) return { granted: true, reason: 'team' }
    return { granted: true, reason: access.mode === 'selected' ? 'selected' : access.mode }
  }
  if (!actor.principalId || actor.principalType === 'anonymous') {
    return { granted: false, reason: 'unauthenticated' }
  }
  return { granted: false, reason: 'unauthorized' }
}
