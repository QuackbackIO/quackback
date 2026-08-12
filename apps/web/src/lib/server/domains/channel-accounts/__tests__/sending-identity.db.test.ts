/**
 * Provisioning and polling a customer-owned sending domain, against a real
 * database and a fake provider.
 *
 * The case that carries this file is the last one: the provider reports the
 * domain fully verified — which it will, to every workspace on the shared
 * account, the moment any one of them verifies it — and the row stays pending
 * because this workspace has published nothing of its own in that zone.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type SendingDomainId, type TeamId } from '@quackback/ids'
import type { SesDomainIdentity, SesIdentityCreation } from '@quackback/email/ses-identity'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, sql, teams, emailSendingDomains, type SendingDomainDnsRecord } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const createIdentity = vi.fn<(domain: string) => Promise<SesIdentityCreation>>()
const getIdentity = vi.fn<(domain: string) => Promise<SesDomainIdentity | null>>()
const putMailFrom = vi.fn<(domain: string, mailFrom: string) => Promise<void>>()

vi.mock('@quackback/email/ses-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email/ses-identity')>()),
  createSesDomainIdentity: (domain: string) => createIdentity(domain),
  getSesDomainIdentity: (domain: string) => getIdentity(domain),
  putSesMailFromDomain: (domain: string, mailFrom: string) => putMailFrom(domain, mailFrom),
}))

/**
 * The DNS check, standing in for the zone.
 *
 * **It takes its arguments, and that is the point of this file.** A stub that
 * ignored them would answer the same for any records it was handed, so every
 * question about WHICH records are checked against the zone would be
 * unanswerable and every test here would pass with the check looking at
 * nothing, or at a value published identically by every workspace on the
 * account. Ownership is the one thing this module decides on its own; a seam
 * that cannot see what was checked cannot test it.
 */
const checkedRecords = vi.fn<(domain: string, expected: SendingDomainDnsRecord[]) => void>()
const ownershipResolves = vi.fn<() => Promise<boolean>>()
vi.mock('../domain-verification', () => ({
  verifySendingDomainDns: async (domain: string, expected: SendingDomainDnsRecord[]) => {
    checkedRecords(domain, expected)
    // Modelled on the real checker, which refuses anything that is not an
    // ownership record and never returns true for an empty expectation. Both
    // are the behaviours a caller could break silently, so the fake keeps them.
    if (expected.length === 0) return false
    if (expected.some((r) => r.type !== 'TXT' || r.purpose !== 'ownership')) return false
    return ownershipResolves()
  },
  ownershipRecordSatisfied: () => false,
}))

/**
 * The plan's cap on sending domains, settable per test.
 *
 * Mocked rather than written into settings because the real reader caches per
 * process, so a row written in one rolled-back transaction would leak its
 * answer into the next test.
 */
const maxSendingDomains = vi.fn<() => number | null>(() => null)
vi.mock('@/lib/server/domains/settings/tier-limits.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/settings/tier-limits.service')>()
  const { OSS_TIER_LIMITS } = await import('@/lib/server/domains/settings/tier-limits.types')
  return {
    ...actual,
    getTierLimits: async () => ({ ...OSS_TIER_LIMITS, maxSendingDomains: maxSendingDomains() }),
  }
})

import { getSendingDomain } from '../channel-account.service'
import {
  OWNERSHIP_VALUE_PREFIX,
  provisionSendingDomain,
  refreshSendingDomain,
  sweepSendingDomains,
} from '../sending-identity'

const REGION = 'eu-west-2'

const identity = (over: Partial<SesDomainIdentity> = {}): SesDomainIdentity => ({
  domain: 'tenant-a.example',
  dkimTokens: ['aaa', 'bbb', 'ccc'],
  signingHostedZone: null,
  dkimStatus: 'SUCCESS',
  verifiedForSending: true,
  mailFrom: { domain: 'bounce.tenant-a.example', status: 'SUCCESS' },
  ...over,
})

/** A create that made the identity: this workspace is the one it belongs to. */
const madeIt = (over: Partial<SesDomainIdentity> = {}): SesIdentityCreation => ({
  identity: identity(over),
  preexisting: false,
})

/** A create that found the identity already there — which on a shared provider
 *  account includes the case where it is another workspace's. */
const foundIt = (over: Partial<SesDomainIdentity> = {}): SesIdentityCreation => ({
  identity: identity(over),
  preexisting: true,
})

/** The records the last DNS check was actually made against. */
const lastChecked = (): SendingDomainDnsRecord[] =>
  (checkedRecords.mock.lastCall?.[1] ?? []) as SendingDomainDnsRecord[]

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.id }).from(emailSendingDomains).limit(0)
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

describe.skipIf(!fixture.available)('sending-identity (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.stubEnv('EMAIL_SES_REGION', REGION)
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', 'mail.platform.test')
    createIdentity.mockReset().mockResolvedValue(madeIt({ dkimStatus: 'PENDING' }))
    getIdentity.mockReset().mockResolvedValue(identity({ dkimStatus: 'PENDING' }))
    putMailFrom.mockReset().mockResolvedValue()
    checkedRecords.mockReset()
    ownershipResolves.mockReset().mockResolvedValue(false)
    maxSendingDomains.mockReset().mockReturnValue(null)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('creates the identity, attaches the MAIL FROM subdomain, and records what to publish', async () => {
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'Tenant-A.Example' })

    expect(createIdentity).toHaveBeenCalledWith('tenant-a.example')
    // A subdomain that receives no mail, so the bounce MX cannot displace the
    // owner's real routing.
    expect(putMailFrom).toHaveBeenCalledWith('tenant-a.example', 'bounce.tenant-a.example')

    expect(row.domain).toBe('tenant-a.example')
    expect(row.status).toBe('pending')
    expect(row.dnsRecords.map((r) => `${r.type} ${r.host}`)).toEqual([
      'TXT _quackback',
      'CNAME aaa._domainkey',
      'CNAME bbb._domainkey',
      'CNAME ccc._domainkey',
      'MX bounce',
      'TXT bounce',
    ])
    const ownership = row.dnsRecords.find((r) => r.purpose === 'ownership')
    expect(ownership?.value.startsWith(OWNERSHIP_VALUE_PREFIX)).toBe(true)
  })

  it('checks the zone for THIS row’s ownership token and nothing else', async () => {
    // The strongest assertion in this suite, because it is the one the whole
    // multi-tenant story rests on. Two things can go wrong and neither shows up
    // as a failing status: checking an EMPTY set (which proves nothing and
    // could be made to look like success), and checking a record whose value is
    // the same for every workspace — the SPF line we hand out in the
    // instructions is exactly such a record, and a check against it would mark
    // any workspace that followed the instructions verified for a domain it
    // does not own. So this pins the records the checker was actually handed.
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    const token = row.dnsRecords.find((r) => r.purpose === 'ownership')?.value

    await refreshSendingDomain(row.id)

    expect(checkedRecords).toHaveBeenCalledWith('tenant-a.example', expect.anything())
    // Exactly the ownership record, carrying this row's own minted token.
    expect(lastChecked()).toEqual([
      { type: 'TXT', host: '_quackback', value: token, purpose: 'ownership' },
    ])
    // Never nothing, and never a value another workspace also publishes.
    expect(lastChecked()).not.toHaveLength(0)
    for (const record of lastChecked()) {
      expect(record.purpose).toBe('ownership')
      expect(record.value.startsWith(OWNERSHIP_VALUE_PREFIX)).toBe(true)
      expect(record.value).not.toContain('amazonses.com')
    }
  })

  it('checks a token no other row could have been issued', async () => {
    // Same domain, two workspaces. Each row's check goes against its own token,
    // so publishing one of them cannot verify the other.
    const a = await provisionSendingDomain({
      owningTeamId: await seedTeam(),
      domain: 'tenant-a.example',
    })
    await refreshSendingDomain(a.id)
    const checkedForA = lastChecked()

    const b = await provisionSendingDomain({
      owningTeamId: await seedTeam(),
      domain: 'tenant-a.example',
    })
    await refreshSendingDomain(b.id)
    const checkedForB = lastChecked()

    expect(checkedForA[0].value).not.toBe(checkedForB[0].value)
  })

  it('does not touch the MAIL FROM of an identity it did not create', async () => {
    // Workspace B adds a domain workspace A already verified. The provider
    // answers "already exists", and attaching a MAIL FROM to that identity
    // would reset A's MAIL FROM to pending — A's replies would fall back to the
    // platform sender until the provider re-scanned. Cost of the attack, if
    // this write happened: one form submission.
    const teamId = await seedTeam()
    createIdentity.mockResolvedValue(foundIt())

    await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })

    expect(createIdentity).toHaveBeenCalledWith('tenant-a.example')
    expect(putMailFrom).not.toHaveBeenCalled()
  })

  it('attaches the MAIL FROM to a pre-existing identity once ownership is proved', async () => {
    // The other half of the same rule: the write is deferred, not abandoned.
    // The domain's real owner publishes the token, the check finds it, and the
    // record only an owner may write is then written.
    const teamId = await seedTeam()
    createIdentity.mockResolvedValue(foundIt({ mailFrom: null }))
    getIdentity.mockResolvedValue(identity({ mailFrom: null }))
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    expect(putMailFrom).not.toHaveBeenCalled()

    ownershipResolves.mockResolvedValue(true)
    await refreshSendingDomain(row.id)
    expect(putMailFrom).toHaveBeenCalledWith('tenant-a.example', 'bounce.tenant-a.example')
  })

  it('leaves a MAIL FROM alone on a poll that proves nothing', async () => {
    const teamId = await seedTeam()
    createIdentity.mockResolvedValue(foundIt({ mailFrom: null }))
    getIdentity.mockResolvedValue(identity({ mailFrom: null }))
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })

    ownershipResolves.mockResolvedValue(false)
    await refreshSendingDomain(row.id)
    expect(putMailFrom).not.toHaveBeenCalled()
  })

  it('re-issues an ownership record whose stored value carries no token', async () => {
    // A row from before ownership existed, or one whose record was mangled. The
    // token is read back by removing a prefix, so a value without that prefix
    // yields a slice of somebody else's string: a token nobody was issued, that
    // the owner cannot publish, and that would keep the row pending forever
    // while looking checked.
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    await testDb
      .update(emailSendingDomains)
      .set({
        dnsRecords: [
          { type: 'TXT', host: '_quackback', value: 'v=spf1 -all', purpose: 'ownership' },
        ],
      })
      .where(eq(emailSendingDomains.id, row.id))

    const refreshed = await refreshSendingDomain(row.id)
    const reissued = refreshed?.dnsRecords.find((r) => r.purpose === 'ownership')
    expect(reissued?.value.startsWith(OWNERSHIP_VALUE_PREFIX)).toBe(true)
    expect(lastChecked()[0].value.startsWith(OWNERSHIP_VALUE_PREFIX)).toBe(true)
  })

  it('mints a different ownership token for every row', async () => {
    // Two workspaces adding the same domain get different tokens, which is what
    // makes publishing one of them proof of anything.
    const a = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: 'a.example' })
    const b = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: 'b.example' })
    const tokenOf = (r: typeof a) => r.dnsRecords.find((x) => x.purpose === 'ownership')?.value
    expect(tokenOf(a)).not.toBe(tokenOf(b))
  })

  it('refuses the platform’s own mail domain before any provider call is made', async () => {
    const teamId = await seedTeam()
    await expect(
      provisionSendingDomain({ owningTeamId: teamId, domain: 'mail.platform.test' })
    ).rejects.toThrow(/platform/i)
    expect(createIdentity).not.toHaveBeenCalled()
  })

  it('fills in the DKIM records the provider had not issued at create time', async () => {
    const teamId = await seedTeam()
    createIdentity.mockResolvedValue(madeIt({ dkimTokens: [], dkimStatus: 'NOT_STARTED' }))
    getIdentity.mockResolvedValue(identity({ dkimTokens: [], dkimStatus: 'NOT_STARTED' }))
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    expect(row.dnsRecords.filter((r) => r.purpose === 'dkim')).toEqual([])

    getIdentity.mockResolvedValue(identity({ dkimStatus: 'PENDING' }))
    const refreshed = await refreshSendingDomain(row.id)
    expect(refreshed?.dnsRecords.filter((r) => r.purpose === 'dkim')).toHaveLength(3)
  })

  it('keeps the ownership token across a poll, so a published record stays valid', async () => {
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
    const before = row.dnsRecords.find((r) => r.purpose === 'ownership')?.value

    const refreshed = await refreshSendingDomain(row.id)
    expect(refreshed?.dnsRecords.find((r) => r.purpose === 'ownership')?.value).toBe(before)
  })

  it('verifies once both authorities agree, stamping the moment it became trustworthy', async () => {
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })

    ownershipResolves.mockResolvedValue(true)
    getIdentity.mockResolvedValue(identity())
    const verified = await refreshSendingDomain(row.id)
    expect(verified?.status).toBe('verified')
    expect(verified?.verifiedAt).not.toBeNull()
    expect(verified?.lastCheckedAt).not.toBeNull()
  })

  it('stays pending while the custom MAIL FROM has not been found', async () => {
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })

    ownershipResolves.mockResolvedValue(true)
    getIdentity.mockResolvedValue(
      identity({ mailFrom: { domain: 'bounce.tenant-a.example', status: 'PENDING' } })
    )
    expect((await refreshSendingDomain(row.id))?.status).toBe('pending')
  })

  it('does NOT verify on the provider’s word alone', async () => {
    // The provider reports this domain fully verified because another workspace
    // on the same account verified it. Nothing has been published in the zone
    // for THIS row's token, so nothing here has been proved.
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })

    getIdentity.mockResolvedValue(identity())
    ownershipResolves.mockResolvedValue(false)

    const checked = await refreshSendingDomain(row.id)
    expect(checked?.status).toBe('pending')
    expect(checked?.verifiedAt).toBeNull()
    expect((await getSendingDomain(row.id))?.status).toBe('pending')
  })

  it('reports a provider that has given up as failed', async () => {
    const teamId = await seedTeam()
    const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })

    ownershipResolves.mockResolvedValue(true)
    getIdentity.mockResolvedValue(identity({ dkimStatus: 'FAILED', verifiedForSending: false }))
    expect((await refreshSendingDomain(row.id))?.status).toBe('failed')
  })

  it('reports nothing for a row that does not exist', async () => {
    expect(await refreshSendingDomain(createId('sending_domain') as SendingDomainId)).toBeNull()
  })

  describe('the plan cap on an account-wide resource', () => {
    it('refuses past the cap before any provider call is made', async () => {
      // The order is the point. The identity quota belongs to the provider
      // account every workspace shares, so the create that must not happen is
      // the one that consumes a slot of it.
      const teamId = await seedTeam()
      maxSendingDomains.mockReturnValue(1)
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      createIdentity.mockClear()

      await expect(
        provisionSendingDomain({ owningTeamId: teamId, domain: 'b.example' })
      ).rejects.toThrow(/sending domains/i)
      expect(createIdentity).not.toHaveBeenCalled()
    })

    it('counts and inserts under one lock, so concurrent adds cannot both pass', async () => {
      // A read-compare-then-act check is honest about the count it saw and
      // useless about the count that results: two callers read the same number,
      // both pass, both consume a slot. What closes that window is the count
      // and the insert sharing a transaction that holds a lock across both, so
      // the lock's existence is the property worth asserting — behaviour cannot
      // show it from one connection, and this can.
      const teamId = await seedTeam()
      maxSendingDomains.mockReturnValue(5)
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })

      const held = await testDb.execute<{ objid: number }>(
        sql`SELECT objid FROM pg_locks
            WHERE locktype = 'advisory'
              AND pid = pg_backend_pid()
              AND objid = (SELECT hashtext('quackback:sending_domain_slot')::bigint & 4294967295)`
      )
      expect([...(held as unknown as { objid: number }[])]).toHaveLength(1)
    })

    it('releases the slot when the provider call fails', async () => {
      // Otherwise a provider outage costs the workspace a permanent slot and
      // leaves a row promising records that will never verify.
      const teamId = await seedTeam()
      maxSendingDomains.mockReturnValue(1)
      createIdentity.mockRejectedValueOnce(new Error('provider unavailable'))

      await expect(
        provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      ).rejects.toThrow(/provider unavailable/)

      createIdentity.mockResolvedValue(madeIt({ dkimStatus: 'PENDING' }))
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      expect(row.status).toBe('pending')
    })

    it('is unlimited when no cap has been written', async () => {
      // The OSS default, and right for a self-hoster who owns the whole
      // provider account. On a fleet the control plane writes the value; a
      // tenant whose limits were never written has no ceiling, which is why
      // writing it is part of provisioning a tenant rather than a default here.
      const teamId = await seedTeam()
      for (const domain of ['a.example', 'b.example', 'c.example']) {
        await provisionSendingDomain({ owningTeamId: teamId, domain })
      }
      expect(await sweepSendingDomains()).toEqual({ checked: 0, demoted: 0 })
    })
  })

  describe('the scheduled re-check', () => {
    beforeEach(() => {
      // The sweep does nothing without a provisioning credential, which is
      // right on an install that never had one and would otherwise produce a
      // configuration error per row per day.
      vi.stubEnv('EMAIL_SES_IDENTITY_ACCESS_KEY_ID', 'AKIA')
      vi.stubEnv('EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY', 'secret')
    })

    it('un-verifies a domain whose ownership record has been deleted', async () => {
      // The failure a button cannot catch. The customer verified months ago and
      // has since removed the TXT record, so nothing now shows this workspace
      // controls the zone it is sending as. Nobody is going to click Re-check
      // to find that out.
      const teamId = await seedTeam()
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
      ownershipResolves.mockResolvedValue(true)
      getIdentity.mockResolvedValue(identity())
      expect((await refreshSendingDomain(row.id))?.status).toBe('verified')

      ownershipResolves.mockResolvedValue(false)
      expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 1 })
      expect((await getSendingDomain(row.id))?.status).toBe('pending')
    })

    it('un-verifies a domain whose MAIL FROM MX has gone', async () => {
      // Aligned SPF is the second DMARC leg. Losing it silently leaves the
      // domain resting on DKIM alone, which is the arrangement that fails the
      // moment a message is forwarded and rewritten.
      const teamId = await seedTeam()
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
      ownershipResolves.mockResolvedValue(true)
      getIdentity.mockResolvedValue(identity())
      expect((await refreshSendingDomain(row.id))?.status).toBe('verified')

      getIdentity.mockResolvedValue(
        identity({ mailFrom: { domain: 'bounce.tenant-a.example', status: 'FAILED' } })
      )
      expect((await sweepSendingDomains()).demoted).toBe(1)
      expect((await getSendingDomain(row.id))?.status).toBe('pending')
    })

    it('un-verifies a domain the provider has stopped signing for', async () => {
      const teamId = await seedTeam()
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
      ownershipResolves.mockResolvedValue(true)
      getIdentity.mockResolvedValue(identity())
      expect((await refreshSendingDomain(row.id))?.status).toBe('verified')

      getIdentity.mockResolvedValue(identity({ verifiedForSending: false }))
      expect((await sweepSendingDomains()).demoted).toBe(1)
      expect((await getSendingDomain(row.id))?.status).toBe('pending')
    })

    it('keeps a domain that is still true, and keeps its original stamp', async () => {
      const teamId = await seedTeam()
      const row = await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
      ownershipResolves.mockResolvedValue(true)
      getIdentity.mockResolvedValue(identity())
      const verifiedAt = (await refreshSendingDomain(row.id))?.verifiedAt

      expect(await sweepSendingDomains()).toEqual({ checked: 1, demoted: 0 })
      const after = await getSendingDomain(row.id)
      expect(after?.status).toBe('verified')
      expect(after?.verifiedAt).toEqual(verifiedAt)
    })

    it('carries on past a domain whose check throws', async () => {
      // One customer's DNS or provider failure must not stop the rest being
      // checked; a sweep that stops at the first error is a sweep that protects
      // whichever workspace sorts first.
      const teamId = await seedTeam()
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'a.example' })
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'b.example' })

      getIdentity.mockReset().mockImplementation(async (domain: string) => {
        if (domain === 'a.example') throw new Error('provider unavailable')
        return identity()
      })
      expect((await sweepSendingDomains()).checked).toBe(1)
    })

    it('does nothing at all without a provisioning credential', async () => {
      const teamId = await seedTeam()
      await provisionSendingDomain({ owningTeamId: teamId, domain: 'tenant-a.example' })
      vi.stubEnv('EMAIL_SES_IDENTITY_ACCESS_KEY_ID', '')
      vi.stubEnv('EMAIL_SES_IDENTITY_SECRET_ACCESS_KEY', '')
      getIdentity.mockClear()

      expect(await sweepSendingDomains()).toEqual({ checked: 0, demoted: 0 })
      expect(getIdentity).not.toHaveBeenCalled()
    })
  })
})
