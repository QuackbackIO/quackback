/**
 * The Domains page rows against a real database, rolled back after each test.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendingDomainId, TeamId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { channelAccounts, emailSendingDomains, ssoVerifiedDomain, teams } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { listSendingDomainSummaries, listSignInDomainSummaries } from '../domains-overview'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.dkimMode }).from(emailSendingDomains).limit(0)
    await db.select({ id: channelAccounts.sendingDomainId }).from(channelAccounts).limit(0)
    await db.select({ id: ssoVerifiedDomain.id }).from(ssoVerifiedDomain).limit(0)
  },
})

const OWNERSHIP = {
  type: 'TXT' as const,
  host: '_quackback',
  value: 'quackback-domain-verification=6f1c2a9e4b8d0f37',
  purpose: 'ownership' as const,
}

let teamId: TeamId

async function seedDomain(
  domain: string,
  status: 'pending' | 'verified' | 'failed'
): Promise<SendingDomainId> {
  const [row] = await testDb
    .insert(emailSendingDomains)
    .values({
      owningTeamId: teamId,
      domain,
      status,
      verifiedAt: status === 'verified' ? new Date() : null,
      dnsRecords: [OWNERSHIP],
    })
    .returning()
  return row.id
}

async function seedAddress(
  address: string,
  opts: { sendingDomainId?: SendingDomainId; role?: 'sending' | 'inbound'; deleted?: boolean } = {}
) {
  await testDb.insert(channelAccounts).values({
    owningTeamId: teamId,
    role: opts.role ?? 'sending',
    address,
    module: 'support',
    sendingDomainId: opts.sendingDomainId ?? null,
    deletedAt: opts.deleted ? new Date() : null,
  })
}

describe.skipIf(!fixture.available)('Domains page rows (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    const [team] = await testDb.insert(teams).values({ name: 'Support' }).returning()
    teamId = team.id
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists each sending domain with the local parts of the live addresses using it', async () => {
    const acme = await seedDomain('acme.com', 'verified')
    await seedDomain('acme.co.uk', 'pending')
    await seedAddress('help@acme.com', { sendingDomainId: acme })
    // Unlinked, matched by its domain.
    await seedAddress('Billing@acme.com')
    await seedAddress('old@acme.com', { sendingDomainId: acme, deleted: true })
    await seedAddress('inbox@acme.com', { role: 'inbound' })
    await seedAddress('updates@acme.co.uk.example.net')

    const rows = await listSendingDomainSummaries()
    const byDomain = Object.fromEntries(
      rows.map((r) => [r.domain, [r.localParts, r.ownershipProven, r.status]])
    )
    expect(byDomain).toEqual({
      'acme.co.uk': [[], false, 'pending'],
      'acme.com': [['billing@', 'help@'], true, 'verified'],
    })
  })

  it('says which sign-in domains another proof covers', async () => {
    await seedDomain('acme.com', 'verified')
    await seedDomain('example.net', 'pending')
    await testDb.insert(ssoVerifiedDomain).values([
      { name: 'acme.com', verificationToken: 't1', verifiedAt: new Date() },
      { name: 'eu.acme.com', verificationToken: 't2' },
      { name: 'example.net', verificationToken: 't3' },
      { name: 'example.org', verificationToken: 't4', verifiedAt: new Date() },
      // Under a verified sign-in domain: one sign-in domain never proves another.
      { name: 'eu.example.org', verificationToken: 't5' },
    ])

    const shown = async (viewer: PermissionKey[]) =>
      Object.fromEntries(
        (await listSignInDomainSummaries(viewer)).map((r) => [r.name, [r.verified, r.provenBy]])
      )
    expect(await shown([PERMISSIONS.AUTH_MANAGE, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE])).toEqual({
      'acme.com': [true, 'email-sending'],
      'eu.acme.com': [false, 'email-sending'],
      'example.net': [false, null],
      'example.org': [true, null],
      'eu.example.org': [false, null],
    })
    // A viewer who cannot see sending learns only that a proof exists.
    expect(await shown([PERMISSIONS.AUTH_MANAGE])).toEqual({
      'acme.com': [true, 'workspace'],
      'eu.acme.com': [false, 'workspace'],
      'example.net': [false, null],
      'example.org': [true, null],
      'eu.example.org': [false, null],
    })
  })
})
