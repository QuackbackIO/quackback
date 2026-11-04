/**
 * The workspace's mail provider tenant against a real database and a fake
 * provider that answers from its arguments: the tenant calls keep per-tenant
 * associations, and the identity call knows only the domains it was told
 * about, so an association made for the wrong tenant or resource shows up.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type TeamId } from '@quackback/ids'
import type { SesIdentityClient } from '@quackback/email/ses-identity'
import type { SesTenantClient } from '@quackback/email/ses-tenant'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  teams,
  user,
  principal,
  channelAccounts,
  emailSendingDomains,
  emailSesTenants,
  inAppNotifications,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { returnPathLabel } from '../return-path'
import { getSesTenantState, sesTenantName, tenantForSend } from '../ses-tenant-state'
import { recordSesTenantPaused, sesTenantPausedNotice } from '../ses-tenant-status'
import { reconcileSesTenant } from '../ses-tenant-reconcile'
import { SES_TENANT_REFRESH_MS, sesTenantReconcileDue } from '../ses-tenant-queue'

const ACCOUNT = 'arn:aws:ses:eu-west-2:123456789012'
const NAME = returnPathLabel('inst_example1')
const arnOf = (kind: string, id: string) => `${ACCOUNT}:${kind}/${id}`

/** The provider: tenants, their associations, and which identities exist. */
const tenants = new Map<string, { arn: string; associations: Set<string> }>()
const identities = new Map<string, { verified: boolean }>()
const reputation = { status: 'ENABLED', cause: null as string | null }
const failAssociate = new Set<string>()
const created: string[] = []

/** The SDK command's class name: the app does not depend on the SDK itself. */
const kind = (command: object) => command.constructor.name

/** The command's input, read loosely once its kind is known. */
type Input = Record<string, string | undefined>

function serviceError(name: string, status: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } })
}

const tenantClient: SesTenantClient = {
  send: async (command) => {
    const input = command.input as unknown as Input
    if (kind(command) === 'CreateTenantCommand') {
      const name = input.TenantName!
      if (tenants.has(name)) throw serviceError('AlreadyExistsException', 400)
      created.push(name)
      tenants.set(name, { arn: `${ACCOUNT}:tenant/${name}/t-1`, associations: new Set() })
      return { TenantArn: tenants.get(name)!.arn, SendingStatus: 'ENABLED' } as never
    }
    if (kind(command) === 'GetTenantCommand') {
      const t = tenants.get(input.TenantName!)
      if (!t) throw serviceError('NotFoundException', 404)
      return { Tenant: { TenantArn: t.arn, SendingStatus: 'ENABLED' } } as never
    }
    if (kind(command) === 'CreateTenantResourceAssociationCommand') {
      const t = tenants.get(input.TenantName!)
      if (!t) throw serviceError('NotFoundException', 404)
      if (failAssociate.has(input.ResourceArn!)) throw serviceError('InternalFailure', 500)
      if (t.associations.has(input.ResourceArn!)) {
        throw serviceError('AlreadyExistsException', 400)
      }
      t.associations.add(input.ResourceArn!)
      return {} as never
    }
    if (kind(command) === 'DeleteTenantResourceAssociationCommand') {
      const t = tenants.get(input.TenantName!)
      if (!t?.associations.delete(input.ResourceArn!)) {
        throw serviceError('NotFoundException', 404)
      }
      return {} as never
    }
    if (kind(command) === 'GetReputationEntityCommand') {
      const known = [...tenants.values()].some(
        (t) => t.arn === input.ReputationEntityReference
      )
      if (!known) throw serviceError('NotFoundException', 404)
      return {
        ReputationEntity: {
          SendingStatusAggregate: reputation.status,
          AwsSesManagedStatus: { Status: reputation.status, Cause: reputation.cause },
        },
      } as never
    }
    throw new Error('unexpected command')
  },
}

const identityClient: SesIdentityClient = {
  send: async (command) => {
    const input = command.input as unknown as Input
    if (!(kind(command) === 'GetEmailIdentityCommand')) throw new Error('unexpected command')
    const found = identities.get(input.EmailIdentity!)
    if (!found) throw serviceError('NotFoundException', 404)
    return {
      VerifiedForSendingStatus: found.verified,
      DkimAttributes: { Tokens: [], Status: found.verified ? 'SUCCESS' : 'PENDING' },
    } as never
  },
}

const deps = { tenant: { client: tenantClient }, identity: { client: identityClient, region: 'eu-west-2' } }
const associationsOf = () => [...(tenants.get(NAME)?.associations ?? [])].sort()

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ n: emailSesTenants.tenantName }).from(emailSesTenants).limit(0)
  },
})

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb.insert(teams).values({ name: `Team-${createId('team')}` }).returning()
  return team.id
}

async function seedDomain(teamId: TeamId, domain: string) {
  const [row] = await testDb
    .insert(emailSendingDomains)
    .values({ owningTeamId: teamId, domain, status: 'verified' })
    .returning()
  return row
}

async function seedAdmin() {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return principalId
}

const pausedBells = (principalId: string) =>
  testDb
    .select()
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.principalId, principalId as never),
        eq(inAppNotifications.type, 'sending_domain_needs_attention')
      )
    )

describe.skipIf(!fixture.available)('ses tenants (real DB, rolled back)', () => {
  let teamId: TeamId

  beforeEach(async () => {
    await fixture.begin()
    vi.stubEnv('EMAIL_SES_TENANTS', 'true')
    vi.stubEnv('EMAIL_SES_CONFIGURATION_SET', 'quackback')
    vi.stubEnv('QUACKBACK_INSTANCE_ID', 'inst_example1')
    vi.stubEnv('QUACKBACK_TENANCY', '')
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@platform.test>')
    tenants.clear()
    identities.clear()
    failAssociate.clear()
    created.length = 0
    reputation.status = 'ENABLED'
    reputation.cause = null
    identities.set('platform.test', { verified: true })
    teamId = await seedTeam()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  describe('tenant name', () => {
    it('is the workspace label, and null with tenants off or no workspace in scope', () => {
      expect(sesTenantName()).toBe(NAME)
      vi.stubEnv('EMAIL_SES_TENANTS', '')
      expect(sesTenantName()).toBeNull()
      vi.stubEnv('EMAIL_SES_TENANTS', 'true')
      vi.stubEnv('QUACKBACK_INSTANCE_ID', '')
      vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
      expect(sesTenantName()).toBeNull()
    })
  })

  describe('reconcile', () => {
    it('creates the tenant once and associates the set, the platform and workspace identities', async () => {
      await seedDomain(teamId, 'acme.test')
      await seedDomain(teamId, 'pending.test')
      identities.set('acme.test', { verified: true })
      identities.set('pending.test', { verified: false })

      expect(await reconcileSesTenant(deps)).toEqual({ skipped: false, ready: true, errors: [] })
      expect(await reconcileSesTenant(deps)).toEqual({ skipped: false, ready: true, errors: [] })

      expect(created).toEqual([NAME])
      expect(associationsOf()).toEqual(
        [
          arnOf('configuration-set', 'quackback'),
          arnOf('identity', 'platform.test'),
          arnOf('identity', 'acme.test'),
          arnOf('identity', 'pending.test'),
        ].sort()
      )
      const state = await getSesTenantState(NAME)
      expect(state?.readyAt).toBeInstanceOf(Date)
      expect(state?.tenantArn).toBe(`${ACCOUNT}:tenant/${NAME}/t-1`)
      // A pending identity is associated, and is not a From that may send yet.
      expect(state?.fromDomains).toEqual(['acme.test', 'platform.test'])
      expect(state?.configurationSet).toBe('quackback')
      expect(state?.sendingStatus).toBe('ENABLED')
    })

    it('resolves an address on a subdomain to the identity that covers it', async () => {
      await seedDomain(teamId, 'acme.test')
      identities.set('acme.test', { verified: true })
      await testDb.insert(channelAccounts).values({
        owningTeamId: teamId,
        role: 'sending',
        address: 'help@mail.acme.test',
        module: 'support',
      })
      await reconcileSesTenant(deps)
      expect((await getSesTenantState(NAME))?.fromDomains).toContain('mail.acme.test')
    })

    it('leaves the tenant unready after a partial failure and completes on retry', async () => {
      failAssociate.add(arnOf('identity', 'platform.test'))
      const first = await reconcileSesTenant(deps)
      expect(first).toMatchObject({ skipped: false, ready: false })
      expect(first.skipped || first.errors.length).toBe(1)
      const unready = await getSesTenantState(NAME)
      expect(unready?.readyAt).toBeNull()
      expect(unready?.fromDomains).toEqual([])
      expect(unready?.lastError).toContain('ses:CreateTenantResourceAssociation')

      failAssociate.clear()
      expect(await reconcileSesTenant(deps)).toMatchObject({ ready: true, errors: [] })
      expect((await getSesTenantState(NAME))?.readyAt).toBeInstanceOf(Date)
    })

    it('stays unready when the platform From has no verified identity', async () => {
      identities.clear()
      expect(await reconcileSesTenant(deps)).toEqual({ skipped: false, ready: false, errors: [] })
      expect((await getSesTenantState(NAME))?.readyAt).toBeNull()
    })

    it('releases a removed domain identity unless another row here still uses it', async () => {
      const otherTeam = await seedTeam()
      const gone = await seedDomain(teamId, 'gone.test')
      await seedDomain(teamId, 'shared.test')
      const sharedElsewhere = await seedDomain(otherTeam, 'shared.test')
      for (const d of ['gone.test', 'shared.test']) identities.set(d, { verified: true })
      await reconcileSesTenant(deps)
      expect(associationsOf()).toContain(arnOf('identity', 'gone.test'))

      await testDb.delete(emailSendingDomains).where(eq(emailSendingDomains.id, gone.id))
      await testDb
        .delete(emailSendingDomains)
        .where(and(eq(emailSendingDomains.domain, 'shared.test'), eq(emailSendingDomains.owningTeamId, teamId)))
      await reconcileSesTenant(deps)

      expect(associationsOf()).not.toContain(arnOf('identity', 'gone.test'))
      expect(associationsOf()).toContain(arnOf('identity', 'shared.test'))
      expect(sharedElsewhere.domain).toBe('shared.test')
      expect((await getSesTenantState(NAME))?.associatedArns).not.toContain(
        arnOf('identity', 'gone.test')
      )
    })

    it('is due on the tick when never run or unready, then daily once ready', async () => {
      expect(await sesTenantReconcileDue()).toBe(true)
      await reconcileSesTenant(deps)
      expect(await sesTenantReconcileDue()).toBe(false)
      expect(await sesTenantReconcileDue(new Date(Date.now() + SES_TENANT_REFRESH_MS))).toBe(true)
      vi.stubEnv('EMAIL_SES_CONFIGURATION_SET', 'other')
      expect(await sesTenantReconcileDue()).toBe(true)
    })

    it('does nothing with tenants off', async () => {
      vi.stubEnv('EMAIL_SES_TENANTS', '')
      expect(await reconcileSesTenant(deps)).toEqual({ skipped: true })
      expect(created).toEqual([])
    })
  })

  describe('which sends go under the tenant', () => {
    beforeEach(async () => {
      await seedDomain(teamId, 'acme.test')
      identities.set('acme.test', { verified: true })
      await reconcileSesTenant(deps)
    })

    it('names the tenant for a From whose identity is associated', async () => {
      expect(await tenantForSend({ from: 'Support <support@acme.test>' })).toBe(NAME)
      expect(await tenantForSend({ from: 'notifications@platform.test' })).toBe(NAME)
    })

    it('sends untenanted from a domain whose identity is not associated', async () => {
      expect(await tenantForSend({ from: 'x@elsewhere.test' })).toBeNull()
    })

    it('sends untenanted with tenants off', async () => {
      vi.stubEnv('EMAIL_SES_TENANTS', '')
      expect(await tenantForSend({ from: 'support@acme.test' })).toBeNull()
    })

    it('sends untenanted with no workspace in scope', async () => {
      vi.stubEnv('QUACKBACK_INSTANCE_ID', '')
      vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
      expect(await tenantForSend({ from: 'support@acme.test' })).toBeNull()
    })

    it('sends untenanted before the tenant is ready', async () => {
      await testDb
        .update(emailSesTenants)
        .set({ readyAt: null })
        .where(eq(emailSesTenants.tenantName, NAME))
      expect(await tenantForSend({ from: 'support@acme.test' })).toBeNull()
    })

    it('sends untenanted when the send would use another configuration set', async () => {
      vi.stubEnv('EMAIL_SES_CONFIGURATION_SET', 'other')
      expect(await tenantForSend({ from: 'support@acme.test' })).toBeNull()
    })
  })

  describe('a paused tenant', () => {
    it('stores the status, rings the bell once, and re-arms after sending resumes', async () => {
      const admin = await seedAdmin()
      await recordSesTenantPaused(NAME, 'Bounce rate above threshold.')
      await recordSesTenantPaused(NAME, 'Bounce rate above threshold.')
      const stored = await getSesTenantState(NAME)
      expect(stored?.sendingStatus).toBe('DISABLED')
      expect(stored?.statusCause).toBe('Bounce rate above threshold.')
      expect(await pausedBells(admin)).toHaveLength(1)
      expect(await sesTenantPausedNotice()).toEqual({ cause: 'Bounce rate above threshold.' })

      // The reconcile reads it sending again: the line goes and the bell re-arms.
      reputation.status = 'REINSTATED'
      await reconcileSesTenant(deps)
      expect(await sesTenantPausedNotice()).toBeNull()

      reputation.status = 'DISABLED'
      reputation.cause = 'Complaint rate above threshold.'
      await reconcileSesTenant(deps)
      expect(await pausedBells(admin)).toHaveLength(2)
      expect(await sesTenantPausedNotice()).toEqual({ cause: 'Complaint rate above threshold.' })
    })

    it('leaves a long cause off the settings line', async () => {
      await recordSesTenantPaused(NAME, 'x'.repeat(400))
      expect(await sesTenantPausedNotice()).toEqual({ cause: null })
    })

    it('shows nothing with tenants off', async () => {
      await recordSesTenantPaused(NAME, 'paused')
      vi.stubEnv('EMAIL_SES_TENANTS', '')
      expect(await sesTenantPausedNotice()).toBeNull()
    })
  })
})
