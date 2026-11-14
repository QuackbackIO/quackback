/**
 * First-run setup over HTTP, against real Postgres rolled back after each test.
 *
 * The suite pins the contract an operator relies on: the token opens the
 * install exactly once, the account it creates really is the workspace's admin
 * and its key really works, and nothing about a wrong or spent token leaks.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  auditLog,
  conversationMessages,
  eq,
  tickets,
  ticketStatuses,
  principal,
  session,
  settings,
  sql,
  user,
  postStatuses,
} from '@/lib/server/db'
import { getSetupState, isOnboardingComplete } from '@/lib/shared/db-types'

vi.hoisted(() => {
  process.env.BASE_URL = 'http://localhost:3000'
  process.env.SECRET_KEY = 'test-secret-key-for-headless-setup-0123456789'
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const logged = vi.hoisted(() => ({ info: [] as string[], warn: [] as string[] }))
// A log call as one string: its fields and its message.
const render = (args: unknown[]) =>
  args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
vi.mock('@/lib/server/logger', () => {
  const fake: Record<string, unknown> = {
    info: (...args: unknown[]) => logged.info.push(render(args)),
    warn: (...args: unknown[]) => logged.warn.push(render(args)),
    error: () => undefined,
    debug: () => undefined,
    child: () => fake,
  }
  return { logger: fake }
})

import { handleSetupRequest } from '../setup-request'
import { ensureBootSetupToken, verifySetupToken } from '../headless-setup'
import { setupWorkspaceForUser } from '../setup-workspace'
import { getBucketCount } from '@/lib/server/utils/rate-bucket'
import { verifyApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import { resolveApiKeyAuthority } from '@/lib/server/domains/api-keys/api-key-authority'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'
import { recomputeTicketFirstResponse } from '@/lib/server/domains/tickets/ticket-first-response'
import { isAutomatedAuthor, PERSONAL_KEY_REPLY_CUTOFF_KEY } from '@/lib/server/messages/reply-rule'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ id: settings.id, setupState: settings.setupState }).from(settings).limit(0)
    await db.select({ id: auditLog.id }).from(auditLog).limit(0)
  },
})

const TOKEN = 'operator-chosen-setup-token-0001'
const BODY = {
  workspaceName: 'Acme Feedback',
  adminEmail: 'Dana@Example.com',
  adminName: 'Dana Admin',
}

function setupRequest(opts: { token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('http://localhost:3000/api/v1/setup', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body === undefined ? BODY : opts.body),
  })
}

async function auditEvents(event: string) {
  return testDb.select().from(auditLog).where(eq(auditLog.eventType, event))
}

afterAll(fixture.close)

describe.skipIf(!fixture.available)('POST /api/v1/setup (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    process.env.SETUP_TOKEN = TOKEN
    logged.info.length = 0
    logged.warn.length = 0
  })
  afterEach(async () => {
    delete process.env.SETUP_TOKEN
    await fixture.rollback()
  })

  it('does not exist when no token is configured', async () => {
    delete process.env.SETUP_TOKEN
    const res = await handleSetupRequest(setupRequest())
    expect(res.status).toBe(404)
    expect(await auditEvents('workspace.setup.rejected')).toHaveLength(0)
  })

  it('refuses a missing or wrong token and records the attempt', async () => {
    expect((await handleSetupRequest(setupRequest({ token: null }))).status).toBe(401)
    expect((await handleSetupRequest(setupRequest({ token: `${TOKEN}x` }))).status).toBe(401)
    expect((await testDb.select().from(settings)).length).toBe(0)
    const events = await auditEvents('workspace.setup.rejected')
    expect(events.map((e) => (e.metadata as { reason: string }).reason).sort()).toEqual([
      'missing_token',
      'wrong_token',
    ])
  })

  it('ignores a token shorter than 32 characters', async () => {
    const short = 'x'.repeat(31)
    process.env.SETUP_TOKEN = short
    const res = await handleSetupRequest(setupRequest({ token: short }))
    expect(res.status).toBe(404)
  })

  it('creates the workspace and first admin and returns a working key once', async () => {
    const res = await handleSetupRequest(setupRequest())
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as {
      data: {
        workspace: { id: string; name: string; slug: string }
        admin: { userId: UserId; principalId: PrincipalId; email: string; name: string }
        apiKey: { id: string; name: string; key: string }
      }
    }
    expect(data.workspace.name).toBe('Acme Feedback')
    expect(data.admin.email).toBe('dana@example.com')
    expect(data.apiKey.key).toMatch(/^qb_[0-9a-f]{48}$/)

    const [admin] = await testDb
      .select()
      .from(principal)
      .where(eq(principal.userId, data.admin.userId))
    expect(admin?.role).toBe('admin')
    expect(admin?.type).toBe('user')
    const [account] = await testDb.select().from(user).where(eq(user.id, data.admin.userId))
    expect(account?.emailVerified).toBe(true)
    expect(account?.name).toBe('Dana Admin')

    const [row] = await testDb.select().from(settings)
    expect(isOnboardingComplete(getSetupState(row?.setupState ?? null))).toBe(true)
    expect((await testDb.select().from(postStatuses)).length).toBeGreaterThan(0)

    // The key works, and records the admin who set the workspace up as its creator.
    const verified = await verifyApiKey(data.apiKey.key)
    expect(verified?.createdById).toBe(data.admin.principalId)

    const done = await auditEvents('workspace.setup.completed')
    expect(done).toHaveLength(1)
    expect(JSON.stringify(done[0])).not.toContain(data.apiKey.key)
  })

  it('mints the setup key as a workspace Owner key, so its replies stay automated', async () => {
    // A cutoff well before the key: a personal key made now would reply as its creator.
    await testDb.execute(sql`
      INSERT INTO kv_store (workspace_key, key, value, expires_at)
      VALUES ('_', ${PERSONAL_KEY_REPLY_CUTOFF_KEY}, to_jsonb('2020-01-01T00:00:00Z'::timestamptz),
        now() + interval '100 years')
      ON CONFLICT (workspace_key, key) DO UPDATE SET value = excluded.value`)

    const res = await handleSetupRequest(setupRequest())
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as {
      data: { admin: { principalId: PrincipalId }; apiKey: { key: string } }
    }

    // A workspace key with the Owner role: workspace-wide, acting as itself,
    // with exactly the tier and permissions the first admin holds (the first
    // admin is an Owner, so a personal key would have carried the same).
    const key = await verifyApiKey(data.apiKey.key)
    expect(key?.kind).toBe('workspace')
    expect(key?.createdById).toBe(data.admin.principalId)
    expect(key?.scopes).toEqual([...API_KEY_SCOPES])
    const authority = await resolveApiKeyAuthority(key!)
    expect(authority?.owner).toBeNull()
    expect(authority?.scopePrincipalId).toBeNull()
    expect(authority?.role).toBe('admin')
    const adminHeld = await permissionsForPrincipal(data.admin.principalId, 'admin')
    expect([...(authority?.permissions ?? [])].sort()).toEqual([...adminHeld].sort())
    expect(authority?.permissions.has(PERMISSIONS.BILLING_MANAGE)).toBe(true)

    // A customer writes on a ticket and the setup key replies: no first response.
    const statusId = createId('ticket_status') as TicketStatusId
    await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: 'setup-key' })
    const ticketId = createId('ticket') as TicketId
    await testDb.insert(tickets).values({ id: ticketId, title: 'T', statusId, type: 'customer' })
    const customer = createId('principal') as PrincipalId
    await testDb
      .insert(principal)
      .values({ id: customer, role: 'user', type: 'anonymous', createdAt: new Date() })
    await testDb.insert(conversationMessages).values([
      {
        ticketId,
        principalId: customer,
        senderType: 'visitor',
        content: 'Help',
        createdAt: new Date('2026-03-02T09:00:00Z'),
      },
      {
        ticketId,
        principalId: key!.principalId,
        senderType: 'agent',
        content: 'On it',
        createdAt: new Date('2026-03-02T09:05:00Z'),
      },
    ])
    await recomputeTicketFirstResponse(ticketId)
    const [ticket] = await testDb
      .select({ firstResponseAt: tickets.firstResponseAt })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
    expect(ticket?.firstResponseAt).toBeNull()
    expect(
      await isAutomatedAuthor(key!.principalId, { type: 'service', principalId: key!.principalId })
    ).toBe(true)
  })

  it('is gone once the first admin exists, and says nothing about why', async () => {
    expect((await handleSetupRequest(setupRequest())).status).toBe(201)
    const rejectedBefore = (await auditEvents('workspace.setup.rejected')).length
    for (const token of [TOKEN, 'nope-nope-nope-nope-nope-nope-1']) {
      const again = await handleSetupRequest(
        setupRequest({ token, body: { ...BODY, adminEmail: 'other@example.com' } })
      )
      expect(again.status).toBe(404)
    }
    const humans = await testDb.select().from(principal).where(eq(principal.type, 'user'))
    expect(humans.filter((p) => p.role === 'admin')).toHaveLength(1)
    expect(await auditEvents('workspace.setup.rejected')).toHaveLength(rejectedBefore)
  })

  it('validates the body', async () => {
    const res = await handleSetupRequest(
      setupRequest({ body: { ...BODY, adminEmail: 'not-an-email' } })
    )
    expect(res.status).toBe(400)
    const res2 = await handleSetupRequest(setupRequest({ body: { adminName: 'Dana Admin' } }))
    expect(res2.status).toBe(400)
    expect((await testDb.select().from(settings)).length).toBe(0)
  })

  it('takes the install even when a stray account signed up first', async () => {
    const strayId = createId('user') as UserId
    await testDb
      .insert(user)
      .values({ id: strayId, name: 'Stray', email: 'stray@example.com', emailVerified: true })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: strayId,
      role: 'user',
      type: 'user',
      createdAt: new Date(Date.now() - 60_000),
    })
    const res = await handleSetupRequest(setupRequest())
    expect(res.status).toBe(201)
    const [stray] = await testDb.select().from(principal).where(eq(principal.userId, strayId))
    expect(stray?.role).toBe('user')
  })

  async function seedAccount(emailVerified: boolean) {
    const existing = createId('user') as UserId
    await testDb
      .insert(user)
      .values({ id: existing, name: 'Dana', email: 'dana@example.com', emailVerified })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: existing,
      role: 'user',
      type: 'user',
      createdAt: new Date(),
    })
    await testDb.insert(session).values({
      id: `sess-${existing}`,
      token: `tok-${existing}`,
      userId: existing,
      scope: 'portal',
      expiresAt: new Date(Date.now() + 3600_000),
      updatedAt: new Date(),
    })
    return existing
  }

  it('promotes a verified account that has the given address and signs it out everywhere', async () => {
    const existing = await seedAccount(true)
    const res = await handleSetupRequest(setupRequest())
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as { data: { reusedExistingAccount: boolean } }
    expect(data.reusedExistingAccount).toBe(true)
    const [p] = await testDb.select().from(principal).where(eq(principal.userId, existing))
    expect(p?.role).toBe('admin')
    expect(await testDb.select().from(session).where(eq(session.userId, existing))).toHaveLength(0)
    const [done] = await auditEvents('workspace.setup.completed')
    expect((done?.metadata as { reusedExistingAccount: boolean }).reusedExistingAccount).toBe(true)
  })

  it('refuses an unverified account that already holds the address', async () => {
    const existing = await seedAccount(false)
    const res = await handleSetupRequest(setupRequest())
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('SETUP_ACCOUNT_UNVERIFIED')
    expect(body.error.message).toMatch(/unverified/i)
    const [p] = await testDb.select().from(principal).where(eq(principal.userId, existing))
    expect(p?.role).toBe('user')
    expect((await testDb.select().from(settings)).length).toBe(0)
  })

  it('reports a fresh account as not reused', async () => {
    const res = await handleSetupRequest(setupRequest())
    const { data } = (await res.json()) as { data: { reusedExistingAccount: boolean } }
    expect(data.reusedExistingAccount).toBe(false)
  })

  it('is not there for a workspace a control plane provisioned', async () => {
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Provisioned',
      slug: 'provisioned',
      createdAt: new Date(),
    })
    await testDb.execute(sql`UPDATE settings SET cloud_workspace_key = 'ws_acme'`)
    const res = await handleSetupRequest(setupRequest())
    expect(res.status).toBe(404)
    expect(await auditEvents('workspace.setup.rejected')).toHaveLength(0)
  })

  it('counts only failed attempts toward the overall budget', async () => {
    await handleSetupRequest(setupRequest({ body: { adminName: 'x' } }))
    expect(await getBucketCount('setup:rl:all')).toBe(0)
    await handleSetupRequest(setupRequest({ token: 'wrong-wrong-wrong-wrong-wrong-1' }))
    expect(await getBucketCount('setup:rl:all')).toBe(1)
  })

  it('throttles repeated attempts from one address', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (await handleSetupRequest(setupRequest({ token: 'wrong-wrong-wrong-wrong-wrong-12' })))
          .status
      )
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses.slice(10)).toEqual([429, 429])
  })
})

describe.skipIf(!fixture.available)('first-boot setup token (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    delete process.env.SETUP_TOKEN
    logged.info.length = 0
    logged.warn.length = 0
  })
  afterEach(fixture.rollback)

  it('prints a token once on a fresh install and accepts only that token', async () => {
    await ensureBootSetupToken()
    const line = logged.info.find((l) => l.includes('First-run setup token'))
    const token = line?.match(/(qbs_[0-9a-f]{48})/)?.[1]
    // The token is a structured field, not part of the sentence.
    expect(line).toContain('"setup_token"')
    expect(token).toBeTruthy()

    expect(await verifySetupToken(token!)).toBe('ok')
    expect(await verifySetupToken('qbs_' + '0'.repeat(48))).toBe('invalid')

    // A restart does not print a second one.
    logged.info.length = 0
    await ensureBootSetupToken()
    expect(logged.info.some((l) => l.includes('First-run setup token'))).toBe(false)
    expect(await verifySetupToken(token!)).toBe('ok')

    const res = await handleSetupRequest(setupRequest({ token: token! }))
    expect(res.status).toBe(201)
  })

  it('prints nothing when the operator set a token or an admin exists', async () => {
    process.env.SETUP_TOKEN = TOKEN
    await ensureBootSetupToken()
    expect(logged.info.some((l) => l.includes('First-run setup token'))).toBe(false)
    delete process.env.SETUP_TOKEN

    const adminUser = createId('user') as UserId
    await testDb
      .insert(user)
      .values({ id: adminUser, name: 'Admin', email: 'a@example.com', emailVerified: true })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: adminUser,
      role: 'admin',
      type: 'user',
      createdAt: new Date(),
    })
    await ensureBootSetupToken()
    expect(logged.info.some((l) => l.includes('First-run setup token'))).toBe(false)
    expect(await verifySetupToken('anything-anything-1')).toBe('not_configured')
  })

  it('prints nothing when the operator named a setup owner', async () => {
    process.env.SETUP_OWNER_EMAIL = 'owner@example.com'
    try {
      await ensureBootSetupToken()
    } finally {
      delete process.env.SETUP_OWNER_EMAIL
    }
    expect(logged.info.some((l) => l.includes('First-run setup token'))).toBe(false)
  })

  async function printedToken() {
    await ensureBootSetupToken()
    const line = logged.info.find((l) => l.includes('First-run setup token'))
    return line!.match(/(qbs_[0-9a-f]{48})/)![1]!
  }

  it('forgets the token once the first admin exists, by either path', async () => {
    const viaSetup = await printedToken()
    expect((await handleSetupRequest(setupRequest({ token: viaSetup }))).status).toBe(201)
    expect(await verifySetupToken(viaSetup)).toBe('not_configured')
  })

  it('forgets the token when the browser wizard makes the first admin', async () => {
    const token = await printedToken()
    const userId = createId('user') as UserId
    await testDb
      .insert(user)
      .values({ id: userId, name: 'Wiz', email: 'wiz@example.com', emailVerified: true })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId,
      role: 'user',
      type: 'user',
      createdAt: new Date(),
    })
    const saved = await setupWorkspaceForUser({
      userId,
      data: { workspaceName: 'Wizard Co' },
      locale: undefined,
    })
    expect(saved.ok).toBe(true)
    expect(await verifySetupToken(token)).toBe('not_configured')
  })
})
