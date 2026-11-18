/**
 * Team and channels after the plan limits grace, against a real database:
 * paused seats, held custom roles, held sending domains, held help center
 * languages and hidden status components. Each hook is driven through the
 * real plan limits state, so each case shows it refusing (or falling back)
 * once enforced, and doing nothing in the grace or with the flag off.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type ApiKeyId,
  type PrincipalId,
  type RoleId,
  type StatusComponentId,
  type TeamId,
  type UserId,
  type WorkspaceId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  boards,
  emailSendingDomains,
  eq,
  inArray,
  invitation,
  isNull,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  settings,
  statusComponents,
  statusIncidentComponents,
  statusIncidents,
  teams,
  user,
} from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { updateHelpCenterLocaleChrome } from '@/lib/server/domains/settings/settings.service'
import { resolveApiKeyAuthority } from '@/lib/server/domains/api-keys/api-key-authority'
import { resolveMcpActor } from '@/lib/server/mcp/resolve-actor'
import type { McpAuthContext } from '@/lib/server/mcp/types'
import { updateRole } from '@/lib/server/domains/roles/role.service'
import { updateMemberRole } from '@/lib/server/domains/principals/principal.service'
import { createSendingAddress } from '@/lib/server/domains/channel-accounts/channel-account.service'
import { setEmailSender } from '@/lib/server/domains/channel-accounts/email-senders'
import { resolveSender } from '@/lib/server/domains/channel-accounts/sender-resolver'
import { permittedSendingIdentity } from '@/lib/server/domains/channel-accounts/outbound-identity'
import { listSendingDomainSummaries } from '@/lib/server/domains/domain-proof/domains-overview'
import { getStatusPageSnapshot, getUptimeSeries } from '@/lib/server/domains/status/status.public'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { getPlanLimits, invalidatePlanLimits } from '../plan-limits.service'
import { isPausedTeamSeat } from '../plan-limits.seats'
import { heldHelpCenterLocales } from '../plan-limits.locales'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

let settingsId: WorkspaceId
let ownerId: PrincipalId

/** No caps but the ones a case sets, so only its own limit is over. */
const UNCAPPED = {
  ...OSS_TIER_LIMITS,
  maxBoards: null,
  maxTeamSeats: null,
  maxCustomRoles: null,
  maxSendingDomains: null,
  maxHelpCenterLocales: null,
  maxStatusComponents: null,
}

async function configure(planLimits: boolean, caps: Record<string, number>) {
  await testDb
    .update(settings)
    .set({
      featureFlags: JSON.stringify({ feedback: true, planLimits }),
      tierLimits: JSON.stringify({ ...UNCAPPED, ...caps }),
      cloud: null,
    })
    .where(eq(settings.id, settingsId))
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
  // Detection on read: the grace starts now.
  await getPlanLimits()
}

/** The three states every hook is checked in: flag off, grace, and enforced. */
async function inEachPhase(
  caps: Record<string, number>,
  check: (phase: 'off' | 'grace' | 'enforced') => Promise<void>
) {
  await configure(false, caps)
  await check('off')
  await configure(true, caps)
  await check('grace')
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
  await invalidatePlanLimits()
  await check('enforced')
}

async function addPerson(name: string, role: 'admin' | 'member'): Promise<PrincipalId> {
  const uid = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: uid, name, email: `${uid}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId: uid, role, type: 'user', createdAt: new Date(0) })
  return id
}

async function addRole(name: string, keys: string[]): Promise<RoleId> {
  const id = createId('role') as RoleId
  await testDb.insert(roles).values({ id, key: id, name, isSystem: false })
  if (keys.length > 0) {
    const rows = await testDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.key, keys))
    await testDb
      .insert(rolePermissions)
      .values(rows.map((p) => ({ roleId: id, permissionId: p.id })))
  }
  return id
}

async function assign(principalId: PrincipalId, roleId: RoleId) {
  await testDb.insert(principalRoleAssignments).values({ principalId, roleId } as never)
}

beforeEach(async () => {
  await fixture.begin()
  vi.useRealTimers()
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  settingsId =
    row?.id ??
    (
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
        .returning({ id: settings.id })
    )[0]!.id
  await testDb.update(settings).set({ planLimitsState: null }).where(eq(settings.id, settingsId))
  // Only this file's rows count toward each cap.
  await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
  await testDb
    .update(principal)
    .set({ role: 'user' })
    .where(inArray(principal.role, ['admin', 'member']))
  await testDb
    .update(invitation)
    .set({ status: 'canceled' })
    .where(eq(invitation.status, 'pending'))
  await testDb.delete(roles).where(eq(roles.isSystem, false))
  await testDb.delete(emailSendingDomains)
  await testDb
    .update(statusComponents)
    .set({ deletedAt: new Date() })
    .where(isNull(statusComponents.deletedAt))
  ownerId = await addPerson('Acme Owner', 'admin')
})
afterEach(async () => {
  vi.useRealTimers()
  await invalidatePlanLimits()
  await fixture.rollback()
})

describe.skipIf(!fixture.available)('seat pause (real DB)', () => {
  it('pauses only the member without a seat, and only once enforced', async () => {
    const memberId = await addPerson('Acme Member', 'member')
    await inEachPhase({ maxTeamSeats: 1 }, async (phase) => {
      expect(await isPausedTeamSeat({ id: memberId, role: 'member', type: 'user' })).toBe(
        phase === 'enforced'
      )
      expect(await isPausedTeamSeat({ id: ownerId, role: 'admin', type: 'user' })).toBe(false)
    })
  })

  it('never pauses the owner or the member with billing rights', async () => {
    // Two seats: the owner, then billing rights, ahead of a more recent member.
    const billingRole = await addRole('Acme Billing', ['billing.manage'])
    const billing = await addPerson('Acme Billing', 'member')
    await assign(billing, billingRole)
    const member = await addPerson('Acme Member', 'member')
    await configure(true, { maxTeamSeats: 2 })
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    await invalidatePlanLimits()
    expect(await isPausedTeamSeat({ id: ownerId, role: 'admin', type: 'user' })).toBe(false)
    expect(await isPausedTeamSeat({ id: billing, role: 'member', type: 'user' })).toBe(false)
    expect(await isPausedTeamSeat({ id: member, role: 'member', type: 'user' })).toBe(true)
  })

  it("refuses a paused member's personal key, and never a workspace key or the owner's", async () => {
    const memberId = await addPerson('Acme Member', 'member')
    const keyPrincipal = createId('principal') as PrincipalId
    await testDb.insert(principal).values({
      id: keyPrincipal,
      role: 'member',
      type: 'service',
      displayName: 'Acme key',
      createdAt: new Date(),
    })
    const personal = (createdById: PrincipalId) => ({
      id: createId('api_key') as ApiKeyId,
      principalId: keyPrincipal,
      createdById,
      kind: 'personal' as const,
    })
    await inEachPhase({ maxTeamSeats: 1 }, async (phase) => {
      expect(await resolveApiKeyAuthority(personal(memberId))).toEqual(
        phase === 'enforced' ? null : expect.objectContaining({ scopePrincipalId: memberId })
      )
      expect(await resolveApiKeyAuthority(personal(ownerId))).not.toBeNull()
      expect(
        await resolveApiKeyAuthority({ ...personal(memberId), kind: 'workspace' })
      ).not.toBeNull()
    })
  })

  it('refuses MCP as a paused member, never as the owner', async () => {
    const memberId = await addPerson('Acme Member', 'member')
    const mcp = (principalId: PrincipalId) =>
      resolveMcpActor({ principalId, authMethod: 'oauth' } as McpAuthContext)
    await inEachPhase({ maxTeamSeats: 1 }, async (phase) => {
      const result = await mcp(memberId).catch((e: { code?: string }) => e.code)
      if (phase === 'enforced') expect(result).toBe('MCP_TEAM_MEMBER_REQUIRED')
      else expect(result).toMatchObject({ principalId: memberId })
      expect(await mcp(ownerId)).toMatchObject({ principalId: ownerId })
    })
  })
})

describe.skipIf(!fixture.available)('custom roles (real DB)', () => {
  it('refuses editing a custom role only once enforced', async () => {
    const custom = await addRole('Acme Support', ['member.view'])
    const editor = { principalId: ownerId, permissions: ['member.view'] as never }
    await inEachPhase({ maxCustomRoles: 0 }, async (phase) => {
      const result = await updateRole(custom, { name: `Acme Support ${phase}` }, editor).catch(
        (e: { code?: string }) => e.code
      )
      if (phase === 'enforced') expect(result).toBe('CUSTOM_ROLES_LOCKED')
      else expect(result).toMatchObject({ name: `Acme Support ${phase}` })
    })
  })

  it('refuses giving a custom role to someone new, and keeps everyone on one', async () => {
    const custom = await addRole('Acme Support', ['member.view'])
    const holder = await addPerson('Acme Holder', 'member')
    await assign(holder, custom)
    const granter = {
      granterPermissions: ['member.view'] as never,
      granterRole: 'admin' as const,
    }
    await inEachPhase({ maxCustomRoles: 0 }, async (phase) => {
      const newcomer = await addPerson(`Acme Newcomer ${phase}`, 'member')
      const result = await updateMemberRole(newcomer, 'member', ownerId, null, undefined, {
        ...granter,
        assignRoleId: custom,
      }).catch((e: { code?: string }) => e.code)
      if (phase === 'enforced') expect(result).toBe('CUSTOM_ROLES_LOCKED')
      else expect(result).toMatchObject({ roleId: custom })
      // The person already on it keeps it, and may be given it again.
      const again = await updateMemberRole(holder, 'member', ownerId, null, undefined, {
        ...granter,
        assignRoleId: custom,
      })
      expect(again).toMatchObject({ roleId: custom })
      const held = await testDb
        .select()
        .from(principalRoleAssignments)
        .where(
          and(
            eq(principalRoleAssignments.principalId, holder),
            eq(principalRoleAssignments.roleId, custom)
          )
        )
      expect(held).toHaveLength(1)
    })
  })
})

describe.skipIf(!fixture.available)('sending domains (real DB)', () => {
  async function verifiedDomain(team: TeamId, domain: string, createdAt: Date) {
    const [row] = await testDb
      .insert(emailSendingDomains)
      .values({
        owningTeamId: team,
        domain,
        status: 'verified',
        verifiedAt: createdAt,
        lastCheckedAt: createdAt,
        createdAt,
        dnsRecords: [],
      })
      .returning({ id: emailSendingDomains.id })
    return row!.id
  }

  it('sends from the default sender instead of a held domain, keeping the domain', async () => {
    const [team] = await testDb
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)))
      .limit(1)
    await verifiedDomain(team!.id, 'acme.example', new Date('2026-01-01T00:00:00Z'))
    const newer = await verifiedDomain(team!.id, 'news.example', new Date('2026-02-01T00:00:00Z'))
    await createSendingAddress({ owningTeamId: team!.id, address: 'hello@acme.example' })
    const news = await createSendingAddress({
      owningTeamId: team!.id,
      address: 'updates@news.example',
    })
    await setEmailSender('changelog', { mode: 'address', channelAccountId: news.id })

    await inEachPhase({ maxSendingDomains: 1 }, async (phase) => {
      const sender = await resolveSender({ surface: 'changelog' })
      if (phase === 'enforced') {
        expect(sender).toMatchObject({ from: 'hello@acme.example', source: 'default' })
      } else {
        expect(sender).toMatchObject({ from: 'updates@news.example', source: 'surface' })
      }
      // The held domain is refused even on a single-workspace install.
      expect(
        await permittedSendingIdentity('updates@news.example', undefined, { quiet: true })
      ).toBe(phase === 'enforced' ? null : 'updates@news.example')
      const summaries = await listSendingDomainSummaries()
      expect(summaries.find((d) => d.id === newer)?.paused).toBe(phase === 'enforced')
    })
    // Nothing is deleted.
    expect(await testDb.select().from(emailSendingDomains)).toHaveLength(2)
  })
})

describe.skipIf(!fixture.available)('help center languages (real DB)', () => {
  it('holds the languages added last past the cap, once enforced', async () => {
    await testDb
      .update(settings)
      .set({
        helpCenterConfig: JSON.stringify({
          ...DEFAULT_HELP_CENTER_CONFIG,
          locales: { default: 'en', additional: ['fr', 'de', 'es'], chrome: {} },
        }),
      })
      .where(eq(settings.id, settingsId))
    await inEachPhase({ maxHelpCenterLocales: 2 }, async (phase) => {
      expect(await heldHelpCenterLocales()).toEqual(phase === 'enforced' ? ['de', 'es'] : [])
      const held = await updateHelpCenterLocaleChrome({
        locale: 'de',
        chrome: { homepageTitle: `Hilfe ${phase}` },
      }).catch((e: { code?: string }) => e.code)
      if (phase === 'enforced') expect(held).toBe('HC_LOCALE_HELD')
      else expect(held).toMatchObject({ chrome: { de: { homepageTitle: `Hilfe ${phase}` } } })
      // The first additional language stays editable.
      expect(
        await updateHelpCenterLocaleChrome({ locale: 'fr', chrome: { homepageTitle: 'Aide' } })
      ).toMatchObject({ additional: ['fr', 'de', 'es'] })
    })
  })
})

describe.skipIf(!fixture.available)('status components (real DB)', () => {
  it('hides the components past the cap from the public page, not from the admin', async () => {
    const insert = async (
      name: string,
      position: number,
      status: 'operational' | 'degraded_performance'
    ) => {
      const [row] = await testDb
        .insert(statusComponents)
        .values({ name, position, showUptime: true, status })
        .returning({ id: statusComponents.id })
      return row!.id as StatusComponentId
    }
    const api = await insert('Acme API', 0, 'operational')
    const web = await insert('Acme Web', 1, 'degraded_performance')
    const [incident] = await testDb
      .insert(statusIncidents)
      .values({
        kind: 'incident',
        title: 'Acme Web is slow',
        status: 'investigating',
        impact: 'minor',
      })
      .returning({ id: statusIncidents.id })
    await testDb.insert(statusIncidentComponents).values({
      incidentId: incident!.id,
      componentId: web,
      componentStatus: 'degraded_performance',
    })

    await inEachPhase({ maxStatusComponents: 1 }, async (phase) => {
      const hidden = phase === 'enforced'
      const snapshot = await getStatusPageSnapshot(ANONYMOUS_ACTOR, { pageDescription: null })
      const names = snapshot.ungroupedComponents.map((c) => c.name)
      expect(names).toEqual(hidden ? ['Acme API'] : ['Acme API', 'Acme Web'])
      expect(JSON.stringify(snapshot).includes('Acme Web')).toBe(!hidden)
      expect(snapshot.topLevel.status).toBe(hidden ? 'operational' : 'degraded_performance')
      expect(snapshot.activeIncidents).toHaveLength(hidden ? 0 : 1)
      const publicUptime = await getUptimeSeries(ANONYMOUS_ACTOR, [api, web])
      expect(publicUptime.map((s) => s.componentId)).toEqual(hidden ? [api] : [api, web])
      const adminUptime = await getUptimeSeries(ANONYMOUS_ACTOR, [api, web], 90, { admin: true })
      expect(adminUptime.map((s) => s.componentId)).toEqual([api, web])
    })
  })
})
