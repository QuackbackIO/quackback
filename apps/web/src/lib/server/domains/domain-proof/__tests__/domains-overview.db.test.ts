/**
 * The Domains page rows against a real database, rolled back after each test.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendingDomainId, TeamId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  channelAccounts,
  domains,
  emailSendingDomains,
  ssoVerifiedDomain,
  teams,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import {
  getDomainDetail,
  listAddedDomainSummaries,
  listSendingDomainSummaries,
  listSignInDomainSummaries,
} from '../domains-overview'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.dkimMode }).from(emailSendingDomains).limit(0)
    await db.select({ id: channelAccounts.sendingDomainId }).from(channelAccounts).limit(0)
    await db.select({ id: ssoVerifiedDomain.id }).from(ssoVerifiedDomain).limit(0)
    await db.select({ id: domains.ownershipToken }).from(domains).limit(0)
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
    expect(await shown([PERMISSIONS.AUTH_MANAGE, PERMISSIONS.SETTINGS_MANAGE])).toEqual({
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

  describe('domains added by name', () => {
    const ADMIN = [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUTH_MANAGE]

    async function seedAdded(name: string, status: 'pending' | 'verified' = 'pending') {
      await testDb.insert(domains).values({
        name,
        ownershipToken: `tok-${name}`,
        status,
        verifiedAt: status === 'verified' ? new Date() : null,
      })
    }

    it('lists each added domain, verified when its own record or a proven zone says so', async () => {
      await seedDomain('acme.com', 'verified')
      await seedAdded('help.acme.com')
      await seedAdded('acme.io', 'verified')
      await seedAdded('acme.co.uk')
      expect(await listAddedDomainSummaries()).toEqual([
        { name: 'acme.co.uk', verified: false },
        { name: 'acme.io', verified: true },
        { name: 'help.acme.com', verified: true },
      ])
    })

    it('reads an added domain with no use: its record, and nothing holding it', async () => {
      await seedAdded('acme.io')
      expect(await getDomainDetail('ACME.io', ADMIN)).toEqual({
        name: 'acme.io',
        added: true,
        status: 'pending',
        record: { host: '_quackback', value: 'quackback-domain-verification=tok-acme.io' },
        verifiedAt: null,
        lastCheckedAt: null,
        provenBy: null,
        inUse: false,
      })
    })

    it('reads a domain only a use holds: proven by the zone that covers it, no record', async () => {
      await seedDomain('acme.com', 'verified')
      expect(await getDomainDetail('acme.com', ADMIN)).toMatchObject({
        name: 'acme.com',
        added: false,
        record: null,
        provenBy: 'email-sending',
        inUse: true,
      })
      // A viewer who cannot see sending learns only that a proof exists.
      expect(await getDomainDetail('acme.com', [PERMISSIONS.AUTH_MANAGE])).toMatchObject({
        provenBy: 'workspace',
      })
    })

    it('reads a verified added domain as verified by its own record, not covered by itself', async () => {
      await seedAdded('acme.io', 'verified')
      await seedAdded('help.acme.io')
      expect(await getDomainDetail('acme.io', ADMIN)).toMatchObject({
        status: 'verified',
        provenBy: null,
      })
      // A name under it is covered by it, and says so.
      expect(await getDomainDetail('help.acme.io', ADMIN)).toMatchObject({
        status: 'pending',
        provenBy: 'domain',
      })
      expect(await getDomainDetail('help.acme.io', [PERMISSIONS.AUTH_MANAGE])).toMatchObject({
        provenBy: 'workspace',
      })
    })

    it('says an added domain is in use while a use holds its name', async () => {
      await seedAdded('acme.com')
      await testDb.insert(ssoVerifiedDomain).values({ name: 'acme.com', verificationToken: 't1' })
      expect(await getDomainDetail('acme.com', ADMIN)).toMatchObject({ added: true, inUse: true })
    })

    it('reads a name never added or used as neither', async () => {
      expect(await getDomainDetail('acme.net', ADMIN)).toMatchObject({
        added: false,
        inUse: false,
        record: null,
      })
    })
  })
})
