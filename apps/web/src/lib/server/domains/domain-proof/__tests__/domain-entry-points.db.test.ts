/**
 * The places a domain is given a use in context (Sign-in's domain list, the
 * help center's own domain) put the domain on Settings > Domains in the same
 * step, against a real database rolled back after each test.
 *
 * Each leaves exactly one domain row and only its own use's records, and doing
 * it again changes neither the row nor its token.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  channelAccounts,
  domains,
  emailSendingDomains,
  identityProvider,
  settings,
  ssoVerifiedDomain,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// Nothing here is cached between tests: each one seeds its own settings row.
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheGet: async () => null,
  cacheSet: async () => {},
  cacheDel: async () => {},
}))
const side = vi.hoisted(() => ({ resets: 0, ensureFails: false }))
vi.mock('@/lib/server/auth', () => ({
  resetAuth: () => {
    side.resets += 1
  },
}))
// Putting the domain on Settings > Domains can be made to fail, to show the use's own write stands.
vi.mock('@/lib/server/domains/domain-proof/domains.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/domain-proof/domains.service')>()
  return {
    ...actual,
    ensureDomain: (...args: Parameters<typeof actual.ensureDomain>) => {
      if (side.ensureFails) throw new Error('domains table unavailable')
      return actual.ensureDomain(...args)
    },
  }
})

import { insertVerifiedDomain } from '@/lib/server/domains/settings/settings.service'
import { setHelpCenterDomain } from '@/lib/server/domains/help-center/help-center-domain.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ t: domains.ownershipToken }).from(domains).limit(0)
    await db.select({ id: ssoVerifiedDomain.id }).from(ssoVerifiedDomain).limit(0)
    await db.select({ id: emailSendingDomains.dkimMode }).from(emailSendingDomains).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedSettings() {
  await testDb.delete(settings)
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date() })
}

const addedDomains = () => testDb.select().from(domains)

/** Every use's own records, to show an entry point made only its own. */
async function useRecords() {
  const [row] = await testDb.select({ hc: settings.helpCenterConfig }).from(settings).limit(1)
  const hc = row?.hc ? (JSON.parse(row.hc) as { domain?: { domain?: string | null } }) : null
  return {
    sending: (await testDb.select().from(emailSendingDomains)).length,
    addresses: (await testDb.select().from(channelAccounts)).length,
    signIn: (await testDb.select().from(ssoVerifiedDomain)).map((d) => d.name),
    helpCenter: hc?.domain?.domain ?? null,
  }
}

describe.skipIf(!fixture.available)('in-context entry points (real DB, rolled back)', () => {
  beforeEach(async () => {
    side.resets = 0
    side.ensureFails = false
    await fixture.begin()
    await seedSettings()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('a sign-in domain', () => {
    async function seedProvider() {
      const [p] = await testDb
        .insert(identityProvider)
        .values({ registrationId: `acme-${suffix()}`, label: 'Acme SSO', clientId: 'client' })
        .returning()
      return p!.id
    }

    it('leaves exactly one domain and only the sign-in record', async () => {
      await insertVerifiedDomain('acme.com', await seedProvider())

      expect((await addedDomains()).map((d) => [d.name, d.status])).toEqual([
        ['acme.com', 'pending'],
      ])
      expect(await useRecords()).toEqual({
        sending: 0,
        addresses: 0,
        signIn: ['acme.com'],
        helpCenter: null,
      })
    })

    it('adds the sign-in domain and rebuilds sign-in even when the domain cannot be put on Settings > Domains', async () => {
      side.ensureFails = true
      const added = await insertVerifiedDomain('acme.com', await seedProvider())

      expect(added.name).toBe('acme.com')
      expect((await useRecords()).signIn).toEqual(['acme.com'])
      expect(side.resets).toBe(1)
      expect(await addedDomains()).toEqual([])
    })

    it('keeps the one domain and its token when added again', async () => {
      const providerId = await seedProvider()
      await insertVerifiedDomain('acme.com', providerId)
      const [first] = await addedDomains()
      await insertVerifiedDomain('acme.com', providerId)

      const after = await addedDomains()
      expect(after).toHaveLength(1)
      expect(after[0]!.ownershipToken).toBe(first!.ownershipToken)
    })
  })

  describe("the help center's own domain", () => {
    it('leaves exactly one domain and only the help center record', async () => {
      await setHelpCenterDomain('help.acme.com')

      expect((await addedDomains()).map((d) => [d.name, d.status])).toEqual([
        ['help.acme.com', 'pending'],
      ])
      expect(await useRecords()).toEqual({
        sending: 0,
        addresses: 0,
        signIn: [],
        helpCenter: 'help.acme.com',
      })
    })

    it('sets the help center domain even when the domain cannot be put on Settings > Domains', async () => {
      side.ensureFails = true
      const set = await setHelpCenterDomain('help.acme.com')

      expect(set.domain).toBe('help.acme.com')
      expect((await useRecords()).helpCenter).toBe('help.acme.com')
    })

    it('keeps the one domain and its token when set again', async () => {
      await setHelpCenterDomain('help.acme.com')
      const [first] = await addedDomains()
      await setHelpCenterDomain('Help.Acme.com')

      const after = await addedDomains()
      expect(after).toHaveLength(1)
      expect(after[0]!.ownershipToken).toBe(first!.ownershipToken)
    })

    it('adds no domain when the help center domain is cleared', async () => {
      await setHelpCenterDomain(null)
      expect(await addedDomains()).toEqual([])
    })
  })
})
