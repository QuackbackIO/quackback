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
import { AUTH_CREDENTIAL_PREFIX } from '@/lib/server/auth/auth-providers'
import { getConfiguredIntegrationTypes } from '@/lib/server/domains/platform-credentials/platform-credential.service'
import { advancedCssRemainder } from '@/lib/shared/theme/readable-css'
import { notTestPrincipal } from '@/lib/server/test-data'
import { config } from '@/lib/server/config'
import { isAiClientConfigured } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
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

/** What {@link loadConfiguredFeatures} reads besides the database. */
export interface ConfiguredFeatureSources {
  customCss: string | null
  /** Custom hostnames serving visitors now (see `PlanLimitsSources`). */
  liveCustomDomains: readonly string[]
  /** Translation is on with languages to translate into (see `PlanLimitsSources`). */
  autoTranslate: boolean
  assistantResponds: boolean
  /** The widget Messages tab or portal chats is open to visitors. */
  visitorChatLive: boolean
  /** An AI client and the assistant's chat model are configured. */
  assistantModel: boolean
  /** An AI client and the translation model are configured. */
  translationModel: boolean
}

/**
 * How much of each paid feature is running now, so the page can say what
 * pauses. Each count is the runtime's own gate without the plan's: a default
 * value, a switched-off record or a surface no visitor can reach is not
 * running, so it never counts.
 */
export async function loadConfiguredFeatures(
  sources: ConfiguredFeatureSources
): Promise<ConfiguredFeatures> {
  const counter = sql<number>`count(*)::int`
  const live = and(eq(workflows.status, 'live'), isNull(workflows.deletedAt))
  const [liveWorkflows, handsToAssistant, activeWebhooks, connected, ssoProviders] =
    await Promise.all([
      countOf(db.select({ count: counter }).from(workflows).where(live)),
      // A live workflow with a "Let the assistant answer" step runs the
      // assistant on any conversation it fires on.
      countOf(
        db
          .select({ count: counter })
          .from(workflows)
          .where(
            and(
              live,
              sql`jsonb_path_exists(${workflows.graph}, '$.nodes[*] ? (@.type == "let_assistant_answer")')`
            )
          )
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
      registeredSsoProviders(),
    ])
  const assistantAnswers =
    sources.assistantResponds &&
    sources.assistantModel &&
    (sources.visitorChatLive || handsToAssistant > 0)
  const configured: Partial<Record<PlanFeatureKey, number>> = {
    workflows: liveWorkflows,
    webhooks: activeWebhooks,
    integrations: connected,
    sso: ssoProviders,
    customDomain: new Set(sources.liveCustomDomains).size,
    // Theme declarations the appearance editor generates are not custom CSS.
    customCss: advancedCssRemainder(sources.customCss ?? '') ? 1 : 0,
    aiAssistant: assistantAnswers ? 1 : 0,
    aiArticleTranslation: sources.autoTranslate && sources.translationModel ? 1 : 0,
  }
  return configured
}

/**
 * Providers sign-in registers: switched on, with a saved credential. The same
 * test as `getRegisteredOidcProviderIds`, without its plan gate.
 */
async function registeredSsoProviders(): Promise<number> {
  const [providers, credentials] = await Promise.all([
    db
      .select({ registrationId: identityProvider.registrationId })
      .from(identityProvider)
      .where(eq(identityProvider.enabled, true)),
    getConfiguredIntegrationTypes(),
  ])
  return providers.filter((p) => credentials.has(`${AUTH_CREDENTIAL_PREFIX}${p.registrationId}`))
    .length
}

/** Live boards with their post counts and newest post. */
export async function loadBoardChoices(): Promise<BoardChoice[]> {
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      slug: boards.slug,
      createdAt: boards.createdAt,
      readOnly: boards.readOnly,
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
    readOnly: row.readOnly,
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
      isAdmin: p.role === 'admin',
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

/**
 * The check the assistant and article translation make before a model call:
 * an AI client and the feature's chat model. A config that cannot load runs
 * no model.
 */
export function modelConfigured(feature: 'assistant' | 'helpCenterTranslate'): boolean {
  try {
    return (
      isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) &&
      getChatModel(feature) !== null
    )
  } catch {
    return false
  }
}
