/**
 * The isolation property against a real database, at the layer that actually
 * chooses the From.
 *
 * A workspace's database IS its world: on a fleet each one gets its own, so
 * "workspace B cannot send as workspace A's domain" is the same statement as
 * "this database holds no verified row for that domain". Each test below sets up
 * one of those two worlds and asks the resolver what it would send as.
 *
 * Pooled tenancy is stubbed on for the same reason the property exists: a
 * single-workspace install owns its whole provider account and has nobody to
 * impersonate, so the guard deliberately stands down there. One test pins that
 * difference so it cannot become an accident.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type TeamId,
  type UserId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  teams,
  channelAccounts,
  emailSendingDomains,
  conversations,
  principal,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  createInboundRoute,
  createSendingAddress,
  createSendingDomain,
  resolveConversationFrom,
  resolveSendingAddress,
} from '../channel-account.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: emailSendingDomains.id }).from(emailSendingDomains).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

/** A visitor, so a conversation row has someone to belong to. */
async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Visitor' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Visitor',
    createdAt: new Date(),
  })
  return principalId
}

/**
 * A row in the state a real verification leaves behind, written directly.
 *
 * Deliberately a hand-built FIXTURE rather than a production helper. There is
 * no supported way for anything in the app to mark a domain verified: the only
 * writer is the checker, which reaches that state by finding this row's own
 * ownership token published in the domain's zone. A helper that set the column
 * would be a second, unguarded route to the exact authority this suite exists
 * to bound, and its presence in the codebase would make it reachable from
 * production code. What this suite asks is what the resolver does once a
 * database is in that state, so the state is set up here, in the test, with an
 * INSERT that could not be mistaken for a feature.
 */
async function seedVerifiedDomain(owningTeamId: TeamId, domain: string): Promise<void> {
  const now = new Date()
  await testDb.insert(emailSendingDomains).values({
    owningTeamId,
    domain,
    status: 'verified',
    verifiedAt: now,
    lastCheckedAt: now,
    dnsRecords: [
      {
        type: 'TXT',
        host: '_quackback',
        value: 'quackback-domain-verification=6f1c2a9e4b8d0f37',
        purpose: 'ownership',
      },
    ],
  })
}

describe.skipIf(!fixture.available)('sending-domain isolation (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    // A fleet: more than one workspace behind one provider account.
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', 'mail.platform.test')
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('refuses a configured sending address on a domain this workspace has not verified', async () => {
    // Workspace B. Someone has typed the other tenant's support address into the
    // sending-address field; the row exists and names a real, fully verified
    // identity on the shared provider account. The provider would sign it.
    const teamId = await seedTeam()
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'support@tenant-a.example',
      module: 'support',
    })

    expect(await resolveSendingAddress(teamId)).toBeNull()
  })

  it('sends as the same address once THIS workspace has verified the domain', async () => {
    // Workspace A: the same row, in the database that also holds the proof.
    const teamId = await seedTeam()
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'support@tenant-a.example',
      module: 'support',
    })
    await seedVerifiedDomain(teamId, 'tenant-a.example')

    expect(await resolveSendingAddress(teamId)).toBe('support@tenant-a.example')
  })

  it('does not accept a domain that is merely pending', async () => {
    const teamId = await seedTeam()
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'support@tenant-a.example',
      module: 'support',
    })
    // Added, records shown, nothing published yet.
    await createSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })

    expect(await resolveSendingAddress(teamId)).toBeNull()
  })

  it('replies from the address the customer wrote to, once its domain is verified', async () => {
    const teamId = await seedTeam()
    const route = await createInboundRoute({
      owningTeamId: teamId,
      config: { forwardingTarget: 'support@tenant-a.example', provider: 'cloudflare' },
    })
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'team@tenant-a.example',
      module: 'support',
    })
    await seedVerifiedDomain(teamId, 'tenant-a.example')

    const [conv] = await testDb
      .insert(conversations)
      .values({
        channel: 'email',
        channelAccountId: route.id,
        assignedTeamId: teamId,
        visitorPrincipalId: await seedVisitor(),
      })
      .returning()

    // The inbox the mail arrived at wins over the team's configured address:
    // a thread that reached support@ should not answer from team@.
    expect(await resolveConversationFrom(conv.id as ConversationId)).toBe(
      'support@tenant-a.example'
    )
  })

  it('falls back past an inbox address whose domain is not verified', async () => {
    // The forwarding target names a domain this workspace never proved. The
    // team's own address is on a domain it did, so the reply still goes out with
    // a real identity instead of being suppressed by the refusal beside it.
    const teamId = await seedTeam()
    const route = await createInboundRoute({
      owningTeamId: teamId,
      config: { forwardingTarget: 'support@tenant-a.example', provider: 'cloudflare' },
    })
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'team@tenant-b.example',
      module: 'support',
    })
    await seedVerifiedDomain(teamId, 'tenant-b.example')

    const [conv] = await testDb
      .insert(conversations)
      .values({
        channel: 'email',
        channelAccountId: route.id,
        assignedTeamId: teamId,
        visitorPrincipalId: await seedVisitor(),
      })
      .returning()

    expect(await resolveConversationFrom(conv.id as ConversationId)).toBe('team@tenant-b.example')
  })

  it('stands down on a single-workspace install', async () => {
    // Same unverified row, one workspace on its own provider account. Refusing
    // here would break a self-hosted deployment to defend against nobody.
    vi.stubEnv('QUACKBACK_TENANCY', '')
    const teamId = await seedTeam()
    await createSendingAddress({
      owningTeamId: teamId,
      address: 'support@tenant-a.example',
      module: 'support',
    })

    expect(await resolveSendingAddress(teamId)).toBe('support@tenant-a.example')
  })
})
