/**
 * Database reads behind the plan limits state: what is set up, and the
 * candidates each chooser picks from. Each returns plain JSON, so the result
 * can sit in the kv cache.
 */
import {
  and,
  db,
  eq,
  emailSendingDomains,
  identityProvider,
  inArray,
  integrations,
  isNull,
  lt,
  max,
  principal,
  principalRoleAssignments,
  roles,
  session,
  sql,
  statusComponentGroups,
  statusComponents,
  user,
  webhooks,
  workflows,
  boards,
  posts,
} from '@/lib/server/db'
import { permissionsForPrincipals } from '@/lib/server/policy/permissions'
import { PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'
import type { PrincipalId } from '@quackback/ids'
import type { StoredCloudIdentityProjection } from '@/lib/shared/db-types'
import { notTestPrincipal } from '@/lib/server/test-data'
import type { PlanFeatureKey } from './plan-limits.features'
import type {
  BoardCandidate,
  ConfiguredFeatures,
  MemberCandidate,
  SendingDomainCandidate,
  StatusComponentCandidate,
} from './plan-limits.rules'

export interface BoardChoice extends BoardCandidate {
  name: string
  slug: string
  /** Newest post on the board, ISO; null when it has none. */
  lastActivityAt: string | null
}

export interface MemberChoice extends MemberCandidate {
  name: string | null
  email: string | null
  /** The workspace roles held, by name. */
  roleNames: string[]
}

export interface StatusComponentChoice extends StatusComponentCandidate {
  name: string
  groupName: string | null
}

export interface SendingDomainChoice extends SendingDomainCandidate {
  domain: string
}

const iso = (value: Date | string | null | undefined): string | null =>
  value == null ? null : new Date(value).toISOString()

const countOf = async (query: Promise<{ count: number }[]>): Promise<number> =>
  (await query)[0]?.count ?? 0

/** The settings row fields {@link loadConfiguredFeatures} reads. */
export interface ConfiguredFeatureSources {
  customCss: string | null
  cloudIdentity: StoredCloudIdentityProjection | null
  helpCenterDomain: string | null
  autoTranslate: boolean
  assistantResponds: boolean
}

/** How much of each paid feature is set up, so the page can say what pauses. */
export async function loadConfiguredFeatures(
  sources: ConfiguredFeatureSources
): Promise<ConfiguredFeatures> {
  const counter = sql<number>`count(*)::int`
  const [liveWorkflows, activeWebhooks, connected, ssoProviders] = await Promise.all([
    countOf(
      db
        .select({ count: counter })
        .from(workflows)
        .where(and(eq(workflows.status, 'live'), isNull(workflows.deletedAt)))
    ),
    countOf(
      db
        .select({ count: counter })
        .from(webhooks)
        .where(and(eq(webhooks.status, 'active'), isNull(webhooks.deletedAt)))
    ),
    countOf(
      db.select({ count: counter }).from(integrations).where(eq(integrations.status, 'active'))
    ),
    countOf(
      db.select({ count: counter }).from(identityProvider).where(eq(identityProvider.enabled, true))
    ),
  ])
  const hostnames = new Set(sources.cloudIdentity?.customDomains?.map((d) => d.hostname) ?? [])
  if (sources.helpCenterDomain) hostnames.add(sources.helpCenterDomain)
  const configured: Partial<Record<PlanFeatureKey, number>> = {
    workflows: liveWorkflows,
    webhooks: activeWebhooks,
    integrations: connected,
    sso: ssoProviders,
    customDomain: hostnames.size,
    customCss: sources.customCss?.trim() ? 1 : 0,
    aiAssistant: sources.assistantResponds ? 1 : 0,
    aiArticleTranslation: sources.autoTranslate ? 1 : 0,
  }
  return configured
}

/** Live boards with their post counts and newest post. */
export async function loadBoardChoices(): Promise<BoardChoice[]> {
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      slug: boards.slug,
      createdAt: boards.createdAt,
      postCount: sql<number>`count(${posts.id})::int`,
      lastActivityAt: max(posts.createdAt),
    })
    .from(boards)
    .leftJoin(
      posts,
      and(
        eq(posts.boardId, boards.id),
        isNull(posts.deletedAt),
        notTestPrincipal(posts.principalId)
      )
    )
    .where(isNull(boards.deletedAt))
    .groupBy(boards.id)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: iso(row.createdAt)!,
    postCount: Number(row.postCount),
    lastActivityAt: iso(row.lastActivityAt),
  }))
}

/**
 * Seat holders: the same people `countSeatUsage` counts as members (human
 * admin and member principals). Pending invites count toward the cap but are
 * not people yet, so they hold no seat.
 *
 * Recent activity ranks the default seat holders, so it is read as it stood
 * before `activeBefore` (the grace end): a member without a seat who signs in
 * after it cannot take one from someone who has it.
 */
export async function loadMemberChoices(activeBefore: Date | null = null): Promise<MemberChoice[]> {
  const lastSession = db
    .select({ userId: session.userId, lastSignInAt: max(session.createdAt).as('last_sign_in_at') })
    .from(session)
    .where(activeBefore ? lt(session.createdAt, activeBefore) : undefined)
    .groupBy(session.userId)
    .as('last_session')
  const people = await db
    .select({
      id: principal.id,
      role: principal.role,
      createdAt: principal.createdAt,
      name: user.name,
      email: user.email,
      lastSignInAt: sql<Date | string | null>`${lastSession.lastSignInAt}`,
    })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .leftJoin(lastSession, eq(lastSession.userId, principal.userId))
    .where(and(inArray(principal.role, ['admin', 'member']), eq(principal.type, 'user')))
  if (people.length === 0) return []

  const ids = people.map((p) => p.id as PrincipalId)
  const [permissionSets, assigned] = await Promise.all([
    permissionsForPrincipals(
      people.map((p) => ({ id: p.id as PrincipalId, role: p.role as Role }))
    ),
    db
      .select({
        principalId: principalRoleAssignments.principalId,
        key: roles.key,
        name: roles.name,
        isSystem: roles.isSystem,
      })
      .from(principalRoleAssignments)
      .innerJoin(roles, eq(roles.id, principalRoleAssignments.roleId))
      .where(
        and(
          inArray(principalRoleAssignments.principalId, ids),
          isNull(principalRoleAssignments.teamId)
        )
      ),
  ])
  const rolesByPrincipal = new Map<string, typeof assigned>()
  for (const row of assigned) {
    rolesByPrincipal.set(row.principalId, [...(rolesByPrincipal.get(row.principalId) ?? []), row])
  }
  return people.map((p) => {
    const held = rolesByPrincipal.get(p.id) ?? []
    // A principal with no role assignment resolves through its legacy role,
    // where admin is the Owner preset.
    const isOwner =
      held.length > 0
        ? held.some((r) => r.isSystem && r.key === SYSTEM_ROLES.OWNER)
        : p.role === 'admin'
    return {
      id: p.id,
      name: p.name ?? null,
      email: p.email ?? null,
      roleNames: held.map((r) => r.name),
      isOwner,
      canManageBilling:
        permissionSets.get(p.id as PrincipalId)?.has(PERMISSIONS.BILLING_MANAGE) ?? false,
      lastActiveAt: iso(p.lastSignInAt),
      createdAt: iso(p.createdAt)!,
    }
  })
}

/** Live status components with their group, in the order the public page shows them. */
export async function loadStatusComponentChoices(): Promise<StatusComponentChoice[]> {
  const rows = await db
    .select({
      id: statusComponents.id,
      name: statusComponents.name,
      position: statusComponents.position,
      groupName: statusComponentGroups.name,
      groupPosition: statusComponentGroups.position,
    })
    .from(statusComponents)
    .leftJoin(statusComponentGroups, eq(statusComponentGroups.id, statusComponents.groupId))
    .where(isNull(statusComponents.deletedAt))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    groupName: row.groupName ?? null,
    groupPosition: row.groupPosition ?? null,
  }))
}

export async function loadSendingDomainChoices(): Promise<SendingDomainChoice[]> {
  const rows = await db
    .select({
      id: emailSendingDomains.id,
      domain: emailSendingDomains.domain,
      status: emailSendingDomains.status,
      createdAt: emailSendingDomains.createdAt,
    })
    .from(emailSendingDomains)
  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt)! }))
}
