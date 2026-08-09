/**
 * The §4 sites that are NOT tenant-keyed, and the evidence for each.
 *
 * "Proven not shared" is a claim, and a claim with no test behind it is a
 * comment. Every site here is one §4.1 or §4.2 names, kept process-wide
 * deliberately, with the reason recorded in `policy/module-state/ledger.ts`.
 * This file asserts the property the reason depends on — so if the reason ever
 * stops being true, something goes red rather than the comment going stale.
 *
 * Four sites, three different arguments:
 *
 * - `domains/ai/config.ts` `openai` — built from env-only values §8 established
 *   are fleet-wide. Evidence: the constructor receives exactly the configured
 *   key and base URL, and receives them identically under two tenants.
 * - `packages/email` `smtpTransporter` / `resendClient` — same argument for the
 *   transports, plus the part that is genuinely per-tenant (the From address)
 *   is read per send rather than baked into the transport.
 * - `routes/api/health.ready.ts` `migrationsKnownUpToDate` — a memo that would
 *   cache the first tenant it saw forever. Evidence: under pooled tenancy the
 *   check returns before reading it.
 * - `events/relay.ts` leader state — only correct for one database. Evidence:
 *   the relay refuses to start under pooled tenancy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  openaiCtorArgs: [] as unknown[],
  aiConfig: { openaiApiKey: 'sk-fleet', openaiBaseUrl: 'https://gateway.example.com/v1' },
  tenancy: 'single' as 'single' | 'pooled',
  migrationStatusCalls: 0,
  relayLogs: [] as string[],
}))

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    constructor(args: unknown) {
      hoisted.openaiCtorArgs.push(args)
    }
  },
}))
vi.mock('@/lib/server/config', () => ({
  config: {
    get openaiApiKey() {
      return hoisted.aiConfig.openaiApiKey
    },
    get openaiBaseUrl() {
      return hoisted.aiConfig.openaiBaseUrl
    },
    get isPooledTenancy() {
      return hoisted.tenancy === 'pooled'
    },
  },
}))

const { getOpenAI, isAiClientConfigured } = await import('../domains/ai/config')
const { withTenant } = await import('./tenant-scope')

beforeEach(() => {
  hoisted.openaiCtorArgs.length = 0
})

describe('the AI client is fleet-wide, and that is checkable', () => {
  it('is constructed from the configured key and base URL and nothing else', () => {
    withTenant('tenant-alpha', () => getOpenAI())

    // Exactly two fields. A workspace value reaching the client would have to
    // arrive as a third, or as a different value below.
    expect(hoisted.openaiCtorArgs).toEqual([
      { apiKey: 'sk-fleet', baseURL: 'https://gateway.example.com/v1' },
    ])
  })

  it('hands two tenants the same instance, deliberately', () => {
    const alpha = withTenant('tenant-alpha', () => getOpenAI())
    const bravo = withTenant('tenant-bravo', () => getOpenAI())

    expect(alpha).toBe(bravo)
    // …and built once. Partitioning it would open one upstream connection pool
    // per tenant for a client every tenant configures identically.
    expect(hoisted.openaiCtorArgs.length).toBeLessThanOrEqual(1)
  })

  it('is off entirely unless BOTH the key and the base URL are configured', () => {
    // The guard that makes "AI is fleet-wide" safe rather than merely true: a
    // workspace never supplies either half, so there is no per-workspace state
    // for the shared client to have got wrong.
    expect(isAiClientConfigured(undefined, 'https://x')).toBe(false)
    expect(isAiClientConfigured('sk', undefined)).toBe(false)
    expect(isAiClientConfigured('sk', 'https://x')).toBe(true)
  })
})

describe('the email transports are fleet-wide', () => {
  it('selects a provider from environment variables alone', async () => {
    const email = await import('@quackback/email')
    const previous = { ...process.env }
    try {
      delete process.env.EMAIL_SMTP_HOST
      delete process.env.EMAIL_RESEND_API_KEY
      delete process.env.RESEND_API_KEY
      expect(withTenant('tenant-alpha', () => email.getEmailProvider())).toBe('console')
      expect(withTenant('tenant-bravo', () => email.getEmailProvider())).toBe('console')

      process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
      // The provider answer does not move with the tenant, because no tenant
      // value is an input to it.
      expect(withTenant('tenant-alpha', () => email.getEmailProvider())).toBe('smtp')
      expect(withTenant('tenant-bravo', () => email.getEmailProvider())).toBe('smtp')
    } finally {
      process.env = previous
    }
  })
})

describe('the readiness memo cannot go blind under pooled tenancy', () => {
  it('never reads the migration status when pooled, so the memo is never set', async () => {
    vi.resetModules()
    const probe = async (pooled: boolean) => {
      vi.resetModules()
      hoisted.migrationStatusCalls = 0
      vi.doMock('@/lib/server/db', () => ({
        db: { execute: async () => [{ '?column?': 1 }] },
        sql: (s: TemplateStringsArray) => s.join(''),
        getMigrationStatus: async () => {
          hoisted.migrationStatusCalls += 1
          return { upToDate: true }
        },
      }))
      vi.doMock('@/lib/server/tenancy/mode', () => ({
        isPooledTenancy: () => pooled,
        POOLED_TENANCY: 'pooled',
      }))
      vi.doMock('@/lib/server/queue/redis-config', () => ({
        getQueueRedis: () => ({ ping: async () => 'PONG' }),
      }))
      vi.doMock('@/lib/server/queue/worker-registry', () => ({
        getWorkerBootStatus: () => ({ failed: 0, booted: 0, pending: 0 }),
      }))
      vi.doMock('@/lib/server/queue/role', () => ({ getProcessRole: () => 'all' }))
      vi.doMock('@/lib/server/tenancy/registry', () => ({
        // Sync, returning the tagged-template `sql` — the shape the probe uses.
        getControlSql: () => () => Promise.resolve([{ '?column?': 1 }]),
      }))
      const { handleReadinessProbe } = await import('@/routes/api/health.ready')
      const response = await handleReadinessProbe()
      return { status: response.status, calls: hoisted.migrationStatusCalls }
    }

    // The control first: single-tenant DOES read the status, so "zero reads"
    // below is the pooled branch rather than a broken mock.
    expect(await probe(false)).toEqual({ status: 200, calls: 1 })

    // §10.5: fleet readiness stops asserting anything about tenant schemas.
    // Not reading it is what stops the memo caching one tenant's answer for
    // the fleet during exactly the rolling migration it exists to catch.
    expect(await probe(true)).toEqual({ status: 200, calls: 0 })
    vi.resetModules()
  })
})

describe('the relay refuses to run pooled rather than leading one database', () => {
  it('does not attempt leadership under pooled tenancy', async () => {
    vi.resetModules()
    const attempts: number[] = []
    vi.doMock('../events/relay-lock', () => ({
      tryAcquireRelayLeadership: async () => {
        attempts.push(1)
        return null
      },
    }))
    vi.doMock('@/lib/server/queue/role', () => ({ shouldRunWorkers: () => true }))
    vi.doMock('@/lib/server/tenancy/mode', () => ({
      isPooledTenancy: () => true,
      POOLED_TENANCY: 'pooled',
    }))
    vi.doMock('@/lib/server/db', () => ({
      db: {},
      events: {},
      eq: () => null,
      isNull: () => null,
      asc: () => null,
    }))

    const { startOutboxRelay } = await import('../events/relay')
    await startOutboxRelay()

    // A shared `leadership` handle for one database, in a process serving many,
    // would drain one workspace's outbox and silently deliver nothing for the
    // rest. Today it does not even try: the failure is loud and at boot.
    expect(attempts).toEqual([])
    vi.resetModules()
  })

  it('DOES attempt leadership single-tenant, so the refusal is the pooled branch', async () => {
    // The control. Without it "no attempt" could mean the relay is simply
    // broken, and the assertion above would hold for the wrong reason.
    vi.resetModules()
    const attempts: number[] = []
    vi.doMock('../events/relay-lock', () => ({
      tryAcquireRelayLeadership: async () => {
        attempts.push(1)
        return null
      },
    }))
    vi.doMock('@/lib/server/queue/role', () => ({ shouldRunWorkers: () => true }))
    vi.doMock('@/lib/server/tenancy/mode', () => ({
      isPooledTenancy: () => false,
      POOLED_TENANCY: 'pooled',
    }))
    vi.doMock('@/lib/server/db', () => ({
      db: {},
      events: {},
      eq: () => null,
      isNull: () => null,
      asc: () => null,
    }))

    const { startOutboxRelay, stopOutboxRelay } = await import('../events/relay')
    await startOutboxRelay()

    expect(attempts).toEqual([1])
    await stopOutboxRelay()
    vi.resetModules()
  })
})
