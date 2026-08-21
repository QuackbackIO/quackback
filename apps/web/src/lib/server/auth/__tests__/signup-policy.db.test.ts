/**
 * `openSignup`, decided against real Postgres.
 *
 * Everything this policy consults is a row: whether a user already holds the
 * address, whether an invitation names it, whether anybody owns setup, and
 * whether a control plane stamped this database. A hand-rolled db double
 * answers all four from one stub and therefore cannot tell them apart — which
 * is the whole seam a signup bypass would hide in, since three of the four are
 * exemptions. So the queries run for real and only `getWorkspaceSettings` is
 * supplied, because the setting is a scalar input to the decision rather than a
 * behaviour a double could get wrong.
 *
 * Every case asks the PORTAL door, the one all three of the policy's callers
 * are. The exemptions are facts about an address rather than about a door, so
 * they hold whichever is asked; the two doors' own divergence, and the stored
 * field each reads, is `signup-policy-audience.db.test.ts`.
 *
 * Two workspace shapes, deliberately unalike, because a fixture set where every
 * workspace looks the same is exactly what hid this:
 *
 *  - PROVISIONED — a `settings` row carrying the control plane's stamp. Its
 *    owner is decided where it was created, so nobody arriving here is it.
 *  - SELF-HOSTED — a `settings` row with no stamp. Its first human genuinely is
 *    the owner, and that path must not regress.
 *
 * The stamp column is a schema-currency PROBE, never a DDL statement this file
 * runs. It ships in migration 0258, so a database that has it is simply a
 * migrated one; asking for it in the probe means the suite either exercises the
 * REAL `to_jsonb(s) ->> 'cloud_workspace_key'` read or skips, and never
 * substitutes something else for it. It must not be added from inside the
 * fixture's transaction: `ALTER TABLE` takes ACCESS EXCLUSIVE on `settings` and
 * holds it until rollback, which is the whole test, so two suites doing it at
 * once deadlock each other. The second provisioned case needs no schema at all:
 * it stamps the metadata bag, the stamp's original home.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings, principal, user, invitation, sql } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const hoisted = vi.hoisted(() => ({ getWorkspaceSettings: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))

const { isAccountCreationAllowed } = await import('../signup-policy')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
    await db.select({ id: invitation.id }).from(invitation).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
    // Migration 0258's column. Probed, not created — see the header.
    await db.execute(sql`select cloud_workspace_key from settings limit 0`)
  },
})

async function seedSettings(opts: { stamp?: string; metadataStamp?: string } = {}): Promise<void> {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
    metadata: opts.metadataStamp
      ? JSON.stringify({ cloudTenant: { v: 1, workspaceKey: opts.metadataStamp, stampedAt: '' } })
      : null,
  })
  if (opts.stamp) {
    await testDb.execute(sql`UPDATE settings SET cloud_workspace_key = ${opts.stamp}`)
  }
}

async function seedUser(email: string): Promise<UserId> {
  const id = createId('user') as UserId
  await testDb.insert(user).values({
    id,
    name: email.split('@')[0],
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function seedAdmin(email: string): Promise<void> {
  const userId = await seedUser(email)
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'admin',
    type: 'user',
    createdAt: new Date(),
  })
}

async function seedInvite(opts: {
  email: string
  status?: string
  kind?: 'team' | 'portal'
  expiresAt?: Date
}): Promise<void> {
  const inviterId = await seedUser(`inviter-${Math.random().toString(36).slice(2, 8)}@acme.example`)
  await testDb.insert(invitation).values({
    id: createId('invite'),
    email: opts.email,
    status: opts.status ?? 'pending',
    kind: opts.kind ?? 'team',
    role: 'member',
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    inviterId,
  })
}

/** A workspace whose admin has said "no self-service accounts". */
const CLOSED = { authConfig: { openSignup: false } }
const OPEN = { authConfig: { openSignup: true } }

describe.skipIf(!fixture.available)('isAccountCreationAllowed', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
    hoisted.getWorkspaceSettings.mockResolvedValue(CLOSED)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('a provisioned workspace', () => {
    // The attack, stated as a test: a stranger who guessed the hostname asks
    // for an account on a workspace that was never theirs.
    it('refuses a stranger when it already has an owner', async () => {
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('stranger@evil.example', 'portal')).toBe(false)
    })

    // The same refusal has to survive the case the exposure actually lives in:
    // provisioning recorded no owner, so nobody has ever signed in and the
    // workspace reads unclaimed.
    it('refuses a stranger when no owner was ever recorded', async () => {
      await seedSettings({ stamp: 'ws_acme' })

      expect(await isAccountCreationAllowed('stranger@evil.example', 'portal')).toBe(false)
    })

    // The shape current provisioning actually writes. Live workspaces created
    // by today's control plane have `cloud_workspace_key` NULL and carry the
    // stamp here, so a fixture set that only ever used the column would leave
    // the whole production cohort unrepresented.
    it('refuses a stranger on a workspace stamped only in the metadata bag', async () => {
      await seedSettings({ metadataStamp: 'ws_acme' })

      expect(await isAccountCreationAllowed('stranger@evil.example', 'portal')).toBe(false)
    })

    // And in the older of the two live bag shapes, which names the workspace
    // `tenantId` instead of `workspaceKey` while declaring the same `v: 1`. The
    // predicate is deliberately presence-only, so both read as provisioned;
    // this is the fixture that would notice if it ever stopped being.
    it('refuses a stranger on a workspace stamped in the older bag shape', async () => {
      await testDb.insert(settings).values({
        id: createId('workspace'),
        name: 'Acme',
        slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date(),
        metadata: JSON.stringify({
          cloudTenant: { v: 1, tenantId: 'ws_acme', stampedAt: '2026-01-01T00:00:00.000Z' },
        }),
      })

      expect(await isAccountCreationAllowed('stranger@evil.example', 'portal')).toBe(false)
    })

    // A portal invitation is as much a grant as a team one, and the lookup
    // filters `kind` explicitly (the schema requires every query against that
    // table to). A filter written as `kind = 'team'` would refuse exactly the
    // person an admin invited to a private portal.
    it('lets somebody holding a pending PORTAL invitation create their account', async () => {
      await seedSettings({ metadataStamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')
      await seedInvite({ email: 'guest@partner.example', kind: 'portal' })

      expect(await isAccountCreationAllowed('guest@partner.example', 'portal')).toBe(true)
    })

    // The control that proves the two cases above are deciding on the stamp and
    // not on some other difference: same rows, stamp removed.
    it('lets the first arrival in once the stamp is gone', async () => {
      await seedSettings({ stamp: 'ws_acme' })
      await testDb.execute(sql`UPDATE settings SET cloud_workspace_key = NULL`)

      expect(await isAccountCreationAllowed('first@acme.example', 'portal')).toBe(true)
    })

    it('still lets the owner the control plane recorded sign in', async () => {
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('owner@acme.example', 'portal')).toBe(true)
    })

    it('still lets an invited person create their account', async () => {
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')
      await seedInvite({ email: 'newhire@acme.example' })

      expect(await isAccountCreationAllowed('newhire@acme.example', 'portal')).toBe(true)
    })

    // An invite the admin cancelled, and one that ran out, are both a "no" that
    // a status-blind lookup would read as a "yes".
    it('does not treat a cancelled or expired invitation as a grant', async () => {
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')
      await seedInvite({ email: 'cancelled@acme.example', status: 'canceled' })
      await seedInvite({
        email: 'stale@acme.example',
        expiresAt: new Date(Date.now() - 86_400_000),
      })

      expect(await isAccountCreationAllowed('cancelled@acme.example', 'portal')).toBe(false)
      expect(await isAccountCreationAllowed('stale@acme.example', 'portal')).toBe(false)
    })

    // The invite paths compare addresses case-insensitively, so an exemption
    // that missed on case would refuse exactly the person an admin invited.
    it('matches an invitation whatever case it was stored in', async () => {
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')
      await seedInvite({ email: 'NewHire@Acme.Example' })

      expect(await isAccountCreationAllowed('newhire@acme.example', 'portal')).toBe(true)
    })

    it('opens up when the workspace says openSignup', async () => {
      hoisted.getWorkspaceSettings.mockResolvedValue(OPEN)
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('anyone@example.com', 'portal')).toBe(true)
    })
  })

  /**
   * A private portal that grants a whole email domain.
   *
   * `portal-access.ts` will only honour that grant for an authenticated account
   * with a verified address — and this gate is what stands between the person
   * and the account. Without the exemption the grant is unreachable by anyone
   * it names: the admin listed the domain, and nobody at it can obtain the
   * account the listing is about.
   */
  describe('a portal that grants a domain', () => {
    const GRANTS_ACME = {
      authConfig: { openSignup: false },
      portalConfig: {
        access: {
          visibility: 'private',
          allowedDomains: ['acme.example'],
          widgetSignIn: false,
          allowedSegmentIds: [],
        },
      },
    }

    it('lets somebody at the granted domain open the account the grant is about', async () => {
      hoisted.getWorkspaceSettings.mockResolvedValue(GRANTS_ACME)
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('newperson@acme.example', 'portal')).toBe(true)
    })

    // The control that proves the list is being read rather than the branch
    // being taken for everyone: one character different in the domain.
    it('still refuses somebody at a domain nobody granted', async () => {
      hoisted.getWorkspaceSettings.mockResolvedValue(GRANTS_ACME)
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('stranger@acme.example.evil', 'portal')).toBe(false)
      expect(await isAccountCreationAllowed('stranger@evil.example', 'portal')).toBe(false)
    })

    // A subdomain is a different domain. `portal-access.ts` compares the whole
    // host with `includes`, and an exemption that matched more broadly than the
    // grant would admit people the grant does not.
    it('does not extend the grant to a subdomain of it', async () => {
      hoisted.getWorkspaceSettings.mockResolvedValue(GRANTS_ACME)
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('stranger@mail.acme.example', 'portal')).toBe(false)
    })

    it('matches the domain whatever case either side was written in', async () => {
      hoisted.getWorkspaceSettings.mockResolvedValue({
        ...GRANTS_ACME,
        portalConfig: {
          access: { ...GRANTS_ACME.portalConfig.access, allowedDomains: ['Acme.Example'] },
        },
      })
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('NewPerson@ACME.example', 'portal')).toBe(true)
    })

    // An empty list is not a grant to everyone.
    it('grants nothing when the list is empty', async () => {
      hoisted.getWorkspaceSettings.mockResolvedValue({
        ...GRANTS_ACME,
        portalConfig: {
          access: { ...GRANTS_ACME.portalConfig.access, allowedDomains: [] },
        },
      })
      await seedSettings({ stamp: 'ws_acme' })
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('anyone@acme.example', 'portal')).toBe(false)
    })
  })

  describe('a self-hosted install', () => {
    // The product's normal install: nobody has signed up yet, and the config
    // file may already have written a settings row whose absent authConfig
    // parses as openSignup:false. Refusing here would leave a workspace that
    // can never be set up.
    it('lets the very first user create an account with sign-ups closed', async () => {
      await seedSettings()

      expect(await isAccountCreationAllowed('first@acme.example', 'portal')).toBe(true)
    })

    it('lets the first user in when there is no settings row at all', async () => {
      hoisted.getWorkspaceSettings.mockResolvedValue(null)

      expect(await isAccountCreationAllowed('first@acme.example', 'portal')).toBe(true)
    })

    // Once somebody owns it, the setting is a statement an admin actually made,
    // and it is enforced.
    it('closes to strangers as soon as it has an admin', async () => {
      await seedSettings()
      await seedAdmin('owner@acme.example')

      expect(await isAccountCreationAllowed('stranger@evil.example', 'portal')).toBe(false)
    })

    // A service principal is not a human owner — the same rule the bootstrap
    // promoter uses — so it must not close the door on the first real person.
    it('is still open to its first human when only a service admin exists', async () => {
      await seedSettings()
      await testDb.insert(principal).values({
        id: createId('principal') as PrincipalId,
        userId: null,
        role: 'admin',
        type: 'service',
        createdAt: new Date(),
      })

      expect(await isAccountCreationAllowed('first@acme.example', 'portal')).toBe(true)
    })

    it('lets an existing account sign in on a closed workspace', async () => {
      await seedSettings()
      await seedAdmin('owner@acme.example')
      await seedUser('regular@acme.example')

      expect(await isAccountCreationAllowed('regular@acme.example', 'portal')).toBe(true)
    })
  })
})
