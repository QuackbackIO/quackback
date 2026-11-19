/**
 * Seed helpers for the plan limits real-DB suites. Every write goes through
 * the test transaction, so it is rolled back after each test. The vi.mock
 * setup lives in each suite (mocks must be hoisted in the test file itself).
 */
import {
  createId,
  type BoardId,
  type PrincipalId,
  type SendingDomainId,
  type StatusComponentId,
  type TeamId,
  type UserId,
  type WorkspaceId,
} from '@quackback/ids'
import { testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  channelAccounts,
  emailSendingDomains,
  eq,
  isNull,
  posts,
  principal,
  settings,
  statusComponents,
  teams,
  user,
  webhooks,
} from '@/lib/server/db'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { featureFlagsWrite } from '@/lib/server/domains/settings/settings.service'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const DAY = 24 * 60 * 60 * 1000

/** Finite board cap and webhooks off, as a plan without them sets. */
export const FREE_LIKE = {
  ...OSS_TIER_LIMITS,
  maxBoards: 1,
  features: { ...OSS_TIER_LIMITS.features, webhooks: false },
}

export async function ensureSettings(): Promise<WorkspaceId> {
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) return row.id
  const [created] = await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    .returning({ id: settings.id })
  return created!.id
}

export async function configure(
  settingsId: WorkspaceId,
  options: { planLimits: boolean; tierLimits?: Record<string, unknown> | null; cloud?: unknown }
): Promise<void> {
  await testDb
    .update(settings)
    .set({
      featureFlags: JSON.stringify({ feedback: true, planLimits: options.planLimits }),
      tierLimits: options.tierLimits === null ? null : JSON.stringify(options.tierLimits ?? {}),
      cloud: (options.cloud ?? null) as never,
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
}

export async function storedState(
  settingsId: WorkspaceId
): Promise<Record<string, unknown> | null> {
  const [row] = await testDb
    .select({ state: settings.planLimitsState })
    .from(settings)
    .where(eq(settings.id, settingsId))
  return (row?.state as Record<string, unknown> | null) ?? null
}

/**
 * A clean slate inside the test transaction: no stored state, and no live
 * boards, status components, sending domains or active webhooks left by
 * other suites.
 */
export async function clearCounted(settingsId: WorkspaceId): Promise<void> {
  await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
  await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
  await testDb
    .update(statusComponents)
    .set({ deletedAt: new Date() })
    .where(isNull(statusComponents.deletedAt))
  await testDb.update(webhooks).set({ status: 'disabled' }).where(isNull(webhooks.deletedAt))
  await testDb.update(channelAccounts).set({ sendingDomainId: null })
  await testDb.delete(emailSendingDomains)
}

export async function addOwner(createdAt = new Date(0)): Promise<PrincipalId> {
  const uid = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: uid, name: 'Acme Owner', email: `${uid}@example.com` })
  await testDb.insert(principal).values({ id, userId: uid, role: 'admin', type: 'user', createdAt })
  return id
}

export async function addBoard(
  name: string,
  postCount: number,
  createdAt: Date,
  authorId: PrincipalId
): Promise<BoardId> {
  const id = createId('board') as BoardId
  await testDb.insert(boards).values({ id, name, slug: String(id), createdAt })
  for (let i = 0; i < postCount; i++) {
    await testDb
      .insert(posts)
      .values({ boardId: id, title: `Acme ${i}`, content: '', principalId: authorId })
  }
  return id
}

export async function addStatusComponent(
  name: string,
  position: number
): Promise<StatusComponentId> {
  const [row] = await testDb
    .insert(statusComponents)
    .values({ name, position })
    .returning({ id: statusComponents.id })
  return row!.id
}

async function anyTeam(): Promise<TeamId> {
  const [row] = await testDb.select({ id: teams.id }).from(teams).limit(1)
  if (row) return row.id
  const [created] = await testDb
    .insert(teams)
    .values({ name: 'Acme team' })
    .returning({ id: teams.id })
  return created!.id
}

export async function addSendingDomain(
  domain: string,
  status: 'pending' | 'verified',
  createdAt: Date
): Promise<SendingDomainId> {
  const [row] = await testDb
    .insert(emailSendingDomains)
    .values({ owningTeamId: await anyTeam(), domain, status, createdAt } as never)
    .returning({ id: emailSendingDomains.id })
  return row!.id
}

export function projectedLimits(boards: number | null) {
  return {
    maxBoards: boards,
    maxPosts: null,
    maxTeamSeats: null,
    maxStatusComponents: null,
    maxCustomRoles: null,
    maxSendingDomains: null,
    aiTokensPerMonth: null,
    emailsPerMonth: null,
    apiRequestsPerMinute: null,
    apiRequestsPerMonth: null,
    maxInboundEmailAddresses: null,
    maxHelpCenterLocales: null,
    maxStatusSubscribers: null,
  }
}

export function projection(
  version: number,
  plan: string,
  maxBoards: number | null,
  entitlements: Record<string, boolean>,
  planLimitsExpireAt: string | null = null
) {
  return {
    version,
    effectivePlan: plan,
    trialStartedAt: null,
    trialExpiresAt: null,
    subscriptionStatus: plan === 'free' ? null : 'active',
    entitlements,
    freeLimits: projectedLimits(1),
    planLimits: projectedLimits(maxBoards),
    planLimitsExpireAt,
    canUpgrade: true,
    canManageBilling: true,
    renewalAt: null,
    cancellationAt: null,
  }
}

/**
 * Every column the running-feature counts read back to what a new workspace
 * stores: no widget, portal or help center config, no custom CSS, no custom
 * domains, and the default modules (Support off).
 */
export async function freshDefaults(settingsId: WorkspaceId): Promise<void> {
  await testDb
    .update(settings)
    .set({
      widgetConfig: null,
      portalConfig: null,
      helpCenterConfig: null,
      customCss: null,
      cloudIdentity: null,
    } as never)
    .where(eq(settings.id, settingsId))
  await invalidateSettingsCache()
}

/** Turn product modules on the way Settings > General does, side effects included. */
export async function turnOn(settingsId: WorkspaceId, flags: Partial<FeatureFlags>): Promise<void> {
  const [row] = await testDb.select().from(settings).where(eq(settings.id, settingsId))
  const { patch } = featureFlagsWrite(row!, flags)
  await testDb.update(settings).set(patch).where(eq(settings.id, settingsId))
  await invalidateSettingsCache()
}

/** Write a column straight, as a settings save would, and drop the caches. */
export async function setColumns(
  settingsId: WorkspaceId,
  values: Partial<typeof settings.$inferInsert>
): Promise<void> {
  await testDb.update(settings).set(values).where(eq(settings.id, settingsId))
  await invalidateSettingsCache()
}
