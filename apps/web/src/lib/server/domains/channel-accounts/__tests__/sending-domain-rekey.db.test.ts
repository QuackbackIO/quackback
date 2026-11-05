/**
 * A domain whose identity already exists and signs with a key nobody can
 * publish: the row holds its own key, encrypted, until it proves ownership,
 * and the identity is then re-keyed to it. Against a real database, a fake
 * provider that keeps state, and a fake zone the real ownership check reads.
 *
 * The case that carries this file: one workspace adds a domain it does not
 * own and removes it again, leaving an identity signing with a key whose
 * public half was only ever in that workspace's row. The domain's real owner
 * must still be able to set it up.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createPublicKey } from 'node:crypto'
import type { TeamId } from '@quackback/ids'
import type { SesDomainIdentity, SesIdentityCreation } from '@quackback/email/ses-identity'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, teams, emailSendingDomains, type SendingDomainDnsRecord } from '@/lib/server/db'
import { decrypt } from '@/lib/server/encryption'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

/** The install secret a held signing key is encrypted under; the cipher is real. */
vi.mock('@/lib/server/secret-key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/secret-key')>()),
  activeSecretKey: () => 'sending-domain-test-secret-0123456789abcdef',
}))

/** Every log line the code under test writes, with its fields, to search for secrets. */
const logged = vi.hoisted(() => [] as unknown[])
vi.mock('@/lib/server/logger', async (importOriginal) => {
  type Recorder = { [level: string]: (...args: unknown[]) => unknown }
  const recorder = (): Recorder => {
    const r: Recorder = { child: () => recorder() }
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      r[level] = (...args: unknown[]) => logged.push(args)
    }
    return r
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/logger')>()),
    logger: recorder(),
  }
})

type Signing = { selector: string; privateKey: string }

/**
 * The provider, holding one identity per domain the way a shared account does.
 * Every double honours its arguments: a create on an existing domain keeps the
 * key it had, and a re-key changes the key the identity signs with.
 */
const provider = vi.hoisted(() => ({
  identities: new Map<string, SesDomainIdentity & { signedWith?: Signing }>(),
}))
const createIdentity = vi.fn<(domain: string, signing?: Signing) => Promise<SesIdentityCreation>>()
const putDkimKey = vi.fn<(domain: string, signing: Signing) => Promise<void>>()
const putMailFrom = vi.fn<(domain: string, mailFrom: string) => Promise<void>>()

vi.mock('@quackback/email/ses-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email/ses-identity')>()),
  createSesDomainIdentity: (domain: string, _deps?: unknown, signing?: Signing) =>
    createIdentity(domain, signing),
  getSesDomainIdentity: async (domain: string) => {
    const found = provider.identities.get(domain)
    if (!found) return null
    const { signedWith: _signedWith, ...identity } = found
    return identity
  },
  putSesDkimSigningKey: (domain: string, signing: Signing) => putDkimKey(domain, signing),
  putSesMailFromDomain: (domain: string, mailFrom: string) => putMailFrom(domain, mailFrom),
}))

/** The zone, by full name and type; ENODATA for anything not published there. */
type ZoneEntry = {
  TXT?: string[][]
  CNAME?: string[]
  MX?: { exchange: string; priority: number }[]
  A?: string[]
  AAAA?: string[]
  NS?: string[]
}
const zone = new Map<string, ZoneEntry>()
vi.mock('@/lib/server/dns/resolver', () => {
  const read = async <K extends keyof ZoneEntry>(host: string, kind: K) => {
    const value = zone.get(host)?.[kind]
    if (!value || value.length === 0) {
      throw Object.assign(new Error(`ENODATA ${host}`), { code: 'ENODATA' })
    }
    return value as NonNullable<ZoneEntry[K]>
  }
  const resolver = {
    resolveTxt: (host: string) => read(host, 'TXT'),
    resolveCname: (host: string) => read(host, 'CNAME'),
    resolveMx: (host: string) => read(host, 'MX'),
    resolve4: (host: string) => read(host, 'A'),
    resolve6: (host: string) => read(host, 'AAAA'),
    resolveNs: (host: string) => read(host, 'NS'),
  }
  return { systemResolver: resolver, interactiveResolver: resolver }
})

/** Publish records into the zone exactly as a domain owner following them would. */
function publish(domain: string, records: SendingDomainDnsRecord[]) {
  for (const r of records) {
    const name = r.host === '@' ? domain : `${r.host}.${domain}`
    const entry = zone.get(name) ?? {}
    if (r.type === 'TXT') entry.TXT = [...(entry.TXT ?? []), [r.value]]
    if (r.type === 'CNAME') entry.CNAME = [r.value]
    if (r.type === 'MX') entry.MX = [{ exchange: r.value, priority: r.priority }]
    zone.set(name, entry)
  }
}

import { deleteSendingDomain, getSendingDomain } from '../channel-account.service'
import { PENDING_SIGNING_KEY_PURPOSE } from '../pending-signing-key'
import { provisionSendingDomain, refreshSendingDomain } from '../sending-identity'

const REGION = 'eu-west-2'
const DOMAIN = 'victim.example'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: emailSendingDomains.id }).from(emailSendingDomains).limit(0)
  },
})

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` })
    .returning()
  return team.id
}

async function storedKey(id: Parameters<typeof getSendingDomain>[0]): Promise<string | null> {
  const [row] = await testDb
    .select({ key: emailSendingDomains.pendingSigningKey })
    .from(emailSendingDomains)
    .where(eq(emailSendingDomains.id, id))
  return row?.key ?? null
}

/** The base64 SPKI public key of a base64 PKCS#1 DER private key. */
function publicHalfOf(privateKey: string): string {
  return createPublicKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs1' })
    .export({ type: 'spki', format: 'der' })
    .toString('base64')
}

/** Set fields on the identity the provider holds, as its own scans would. */
function providerReports(over: Partial<SesDomainIdentity>) {
  const current = provider.identities.get(DOMAIN)
  if (!current) throw new Error('no identity')
  provider.identities.set(DOMAIN, { ...current, ...over })
}

/**
 * Workspace A adds the domain without owning it and removes the row. The
 * identity stays (nothing here can delete one) and signs with A's key, whose
 * public half nobody can publish now; the provider gives up on it.
 */
async function squat(dkimStatus: SesDomainIdentity['dkimStatus'] = 'FAILED') {
  const squatter = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
  await deleteSendingDomain(squatter.id)
  providerReports({ dkimStatus, verifiedForSending: false })
  return squatter
}

describe.skipIf(!fixture.available)('re-keying a squatted identity (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.stubEnv('EMAIL_SES_REGION', REGION)
    vi.stubEnv('EMAIL_FROM', 'Quackback <notifications@mail.platform.test>')
    vi.stubEnv('EMAIL_INBOUND_DOMAIN', 'mail.platform.test')
    logged.length = 0
    provider.identities.clear()
    zone.clear()
    createIdentity.mockReset().mockImplementation(async (domain, signing) => {
      const existing = provider.identities.get(domain)
      if (existing) {
        const { signedWith: _signedWith, ...identity } = existing
        return { identity, preexisting: true }
      }
      const identity: SesDomainIdentity = {
        domain,
        dkimTokens: [],
        signingHostedZone: null,
        dkimStatus: 'PENDING',
        signingOrigin: signing ? 'external' : 'ses',
        verifiedForSending: false,
        mailFrom: null,
      }
      provider.identities.set(domain, { ...identity, signedWith: signing })
      return { identity, preexisting: false }
    })
    putDkimKey.mockReset().mockImplementation(async (domain, signing) => {
      const current = provider.identities.get(domain)
      if (!current) throw new Error('NotFoundException')
      provider.identities.set(domain, {
        ...current,
        signingOrigin: 'external',
        dkimStatus: 'PENDING',
        signedWith: signing,
      })
    })
    putMailFrom.mockReset().mockImplementation(async (domain, mailFrom) => {
      const current = provider.identities.get(domain)
      if (current) {
        provider.identities.set(domain, {
          ...current,
          mailFrom: { domain: mailFrom, status: 'PENDING' },
        })
      }
    })
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('lets the real owner set the domain up: holds its key until ownership is proved, then re-keys', async () => {
    const squatter = await squat()
    const squatterKey = createIdentity.mock.calls[0][1]

    const owner = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
    const ownerKey = createIdentity.mock.calls[1][1]
    expect(ownerKey?.privateKey.length).toBeGreaterThan(100)
    expect(owner.dkimMode).toBe('shared')

    // Held encrypted: not the plaintext, and it opens to exactly the key.
    const sealed = await storedKey(owner.id)
    expect(sealed).not.toBeNull()
    expect(sealed).not.toContain(ownerKey?.privateKey ?? '')
    expect(decrypt(sealed ?? '', PENDING_SIGNING_KEY_PURPOSE)).toBe(ownerKey?.privateKey)

    // Its own key TXT and the return path; nothing it could not publish.
    expect(owner.dnsRecords.map((r) => `${r.type} ${r.host}`)).toEqual([
      `TXT ${ownerKey?.selector}._domainkey`,
      'MX qb-bounce',
      'TXT qb-bounce',
    ])
    expect(owner.dnsRecords[0].host).not.toContain(squatterKey?.selector ?? '-')

    // Nothing published yet: no re-key, and the squatter's dead key is not a
    // verdict on this row.
    const early = await refreshSendingDomain(owner.id)
    expect(putDkimKey).not.toHaveBeenCalled()
    expect(early?.status).toBe('pending')
    expect(await storedKey(owner.id)).toBe(sealed)

    // The owner publishes; the next check proves ownership and re-keys.
    publish(DOMAIN, owner.dnsRecords)
    const rekeyed = await refreshSendingDomain(owner.id)
    expect(putDkimKey).toHaveBeenCalledTimes(1)
    const [domain, signing] = putDkimKey.mock.calls[0]
    expect(domain).toBe(DOMAIN)
    expect(signing.selector).toBe(ownerKey?.selector)
    expect(`${signing.selector}._domainkey`).toBe(owner.dnsRecords[0].host)
    expect(owner.dnsRecords[0].value).toBe(`v=DKIM1; k=rsa; p=${publicHalfOf(signing.privateKey)}`)
    expect(rekeyed?.dkimMode).toBe('byo')
    expect(await storedKey(owner.id)).toBeNull()
    expect(rekeyed?.status).toBe('pending')
    expect(provider.identities.get(DOMAIN)?.signedWith?.selector).toBe(ownerKey?.selector)

    // The provider finds the published key, and the domain goes live.
    providerReports({
      dkimStatus: 'SUCCESS',
      verifiedForSending: true,
      mailFrom: { domain: `qb-bounce.${DOMAIN}`, status: 'SUCCESS' },
    })
    expect((await refreshSendingDomain(owner.id))?.status).toBe('verified')
    expect(putDkimKey).toHaveBeenCalledTimes(1)
    expect(squatter.id).not.toBe(owner.id)
  })

  it('re-keys an identity still pending on a key nobody can publish', async () => {
    await squat('PENDING')
    const owner = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
    expect(await storedKey(owner.id)).not.toBeNull()
    publish(DOMAIN, owner.dnsRecords)
    expect((await refreshSendingDomain(owner.id))?.dkimMode).toBe('byo')
    expect(putDkimKey).toHaveBeenCalledTimes(1)
  })

  it('keeps an identity that already signs: no key held, no re-key, shared as before', async () => {
    // Someone published that identity's key, so it works; whoever proves
    // ownership next joins it rather than replacing what signs.
    await squat()
    providerReports({ dkimStatus: 'SUCCESS', verifiedForSending: true })
    const owner = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
    expect(owner.dkimMode).toBe('shared')
    expect(await storedKey(owner.id)).toBeNull()

    publish(DOMAIN, owner.dnsRecords)
    const checked = await refreshSendingDomain(owner.id)
    expect(putDkimKey).not.toHaveBeenCalled()
    expect(checked?.dkimMode).toBe('shared')
  })

  it('does not re-key an identity that started verifying while the row waited', async () => {
    await squat()
    const owner = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
    expect(await storedKey(owner.id)).not.toBeNull()
    providerReports({ dkimStatus: 'SUCCESS', verifiedForSending: true })
    publish(DOMAIN, owner.dnsRecords)
    const checked = await refreshSendingDomain(owner.id)
    expect(putDkimKey).not.toHaveBeenCalled()
    expect(checked?.dkimMode).toBe('shared')
  })

  it('holds no key for an identity on the provider’s own keys', async () => {
    provider.identities.set(DOMAIN, {
      domain: DOMAIN,
      dkimTokens: ['aaa', 'bbb', 'ccc'],
      signingHostedZone: null,
      dkimStatus: 'FAILED',
      signingOrigin: 'ses',
      verifiedForSending: false,
      mailFrom: null,
    })
    const owner = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
    expect(owner.dkimMode).toBe('shared')
    expect(await storedKey(owner.id)).toBeNull()
    expect(owner.dnsRecords.filter((r) => r.type === 'CNAME')).toHaveLength(3)
    publish(DOMAIN, owner.dnsRecords)
    await refreshSendingDomain(owner.id)
    expect(putDkimKey).not.toHaveBeenCalled()
  })

  it('keeps the key and the mode when the re-key fails, and tries again next check', async () => {
    await squat()
    const owner = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
    const sealed = await storedKey(owner.id)
    publish(DOMAIN, owner.dnsRecords)

    putDkimKey.mockRejectedValueOnce(new Error('throttled'))
    const failed = await refreshSendingDomain(owner.id)
    expect(putDkimKey).toHaveBeenCalledTimes(1)
    expect(failed?.dkimMode).toBe('shared')
    expect(failed?.status).toBe('pending')
    expect(await storedKey(owner.id)).toBe(sealed)

    const retried = await refreshSendingDomain(owner.id)
    expect(putDkimKey).toHaveBeenCalledTimes(2)
    expect(retried?.dkimMode).toBe('byo')
    expect(await storedKey(owner.id)).toBeNull()
  })

  it('never lets the held key out: not in the returned rows’ records, the logs or a failure', async () => {
    await squat()
    const owner = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
    const privateKey = createIdentity.mock.calls[1][1]?.privateKey ?? ''
    const sealed = (await storedKey(owner.id)) ?? ''
    publish(DOMAIN, owner.dnsRecords)
    putDkimKey.mockRejectedValueOnce(new Error('throttled'))
    await refreshSendingDomain(owner.id)
    await refreshSendingDomain(owner.id)

    expect(privateKey.length).toBeGreaterThan(100)
    expect(JSON.stringify(owner.dnsRecords)).not.toContain(privateKey)
    expect(logged.length).toBeGreaterThan(0)
    expect(JSON.stringify(logged)).not.toContain(privateKey)
    expect(JSON.stringify(logged)).not.toContain(sealed)
  })

  it('goes with the row when the row is deleted', async () => {
    await squat()
    const owner = await provisionSendingDomain({ owningTeamId: await seedTeam(), domain: DOMAIN })
    expect(await storedKey(owner.id)).not.toBeNull()
    await deleteSendingDomain(owner.id)
    const [left] = await testDb
      .select({ id: emailSendingDomains.id })
      .from(emailSendingDomains)
      .where(eq(emailSendingDomains.id, owner.id))
    expect(left).toBeUndefined()
  })
})
