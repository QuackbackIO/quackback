/**
 * The §4 sites that are NOT workspace-keyed, and the evidence for each.
 *
 * "Proven not shared" is a claim, and a claim with no test behind it is a
 * comment. Every site here is one §4.1 or §4.2 names, kept process-wide
 * deliberately, with the reason recorded in `policy/module-state/ledger.ts`.
 * This file asserts the property the reason depends on — so if the reason ever
 * stops being true, something goes red rather than the comment going stale.
 *
 * Three sites, three different arguments:
 *
 * - `domains/ai/config.ts` `openai` — built from env-only values §8 established
 *   are fleet-wide. Evidence: the constructor receives exactly the configured
 *   key and base URL, and receives them identically under two workspaces.
 * - `packages/email` `smtpTransporter` / `resendClient` — same argument for the
 *   transports, plus the part that is genuinely per-workspace (the From address)
 *   is read per send rather than baked into the transport.
 * - `routes/api/health.ready.ts` `migrationsKnownUpToDate` — a memo that would
 *   cache the first workspace it saw forever. Evidence: under pooled workspaces the
 *   check returns before reading it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  openaiCtorArgs: [] as unknown[],
  aiConfig: { openaiApiKey: 'sk-fleet', openaiBaseUrl: 'https://gateway.example.com/v1' },
  workspaces: 'single' as 'single' | 'pooled',
  migrationStatusCalls: 0,
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
      return hoisted.workspaces === 'pooled'
    },
  },
}))

const { getOpenAI, isAiClientConfigured } = await import('../domains/ai/config')
const { withWorkspace } = await import('./workspace-scope')

beforeEach(() => {
  hoisted.openaiCtorArgs.length = 0
})

describe('the AI client is fleet-wide, and that is checkable', () => {
  it('is constructed from the configured key and base URL and nothing else', () => {
    withWorkspace('workspace-alpha', () => getOpenAI())

    // Exactly two fields. A workspace value reaching the client would have to
    // arrive as a third, or as a different value below.
    expect(hoisted.openaiCtorArgs).toEqual([
      { apiKey: 'sk-fleet', baseURL: 'https://gateway.example.com/v1' },
    ])
  })

  it('hands two workspaces the same instance, deliberately', () => {
    const alpha = withWorkspace('workspace-alpha', () => getOpenAI())
    const bravo = withWorkspace('workspace-bravo', () => getOpenAI())

    expect(alpha).toBe(bravo)
    // …and built once. Partitioning it would open one upstream connection pool
    // per workspace for a client every workspace configures identically.
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
      delete process.env.EMAIL_SES_ACCESS_KEY_ID
      delete process.env.EMAIL_SES_SECRET_ACCESS_KEY
      expect(withWorkspace('workspace-alpha', () => email.getEmailProvider())).toBe('console')
      expect(withWorkspace('workspace-bravo', () => email.getEmailProvider())).toBe('console')

      process.env.EMAIL_SMTP_HOST = 'smtp.example.com'
      // The provider answer does not move with the workspace, because no workspace
      // value is an input to it.
      expect(withWorkspace('workspace-alpha', () => email.getEmailProvider())).toBe('smtp')
      expect(withWorkspace('workspace-bravo', () => email.getEmailProvider())).toBe('smtp')
    } finally {
      process.env = previous
    }
  })
})

describe('the readiness memo cannot go blind under pooled workspaces', () => {
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
      vi.doMock('@/lib/server/workspaces/mode', () => ({
        isPooledTenancy: () => pooled,
        POOLED_TENANCY: 'pooled',
      }))
      // A web replica, so the probe's worker-tier check is vacuously ok and
      // this test stays about the migration memo. What that check asserts is
      // covered where it belongs, in `routes/api/__tests__/health-probes.test.ts`.
      vi.doMock('@/lib/server/process-role', () => ({
        getProcessRole: () => 'web',
        shouldRunWorkers: () => false,
      }))
      vi.doMock('@/lib/server/workspaces/registry', () => ({
        // Sync, returning the tagged-template `sql` — the shape the probe uses.
        getControlSql: () => () => Promise.resolve([{ '?column?': 1 }]),
        // The probe no longer opens its own connection on every poll: it reads
        // the outcome of the last real registry read and only connects when
        // there is no recent one. A probe that connected every few seconds was
        // the client holding the control compute awake. Both halves are stubbed
        // here — the observation says nothing, so this fixture exercises the
        // fallback connection, which is the branch that used to be the only one.
        getControlReadState: () => ({ lastOkAt: 0, lastErrorAt: 0, lastError: null }),
        probeControlDatabase: async () => {},
      }))
      const { handleReadinessProbe } = await import('@/routes/api/health.ready')
      const response = await handleReadinessProbe()
      return { status: response.status, calls: hoisted.migrationStatusCalls }
    }

    // The control first: single-workspace DOES read the status, so "zero reads"
    // below is the pooled branch rather than a broken mock.
    expect(await probe(false)).toEqual({ status: 200, calls: 1 })

    // §10.5: fleet readiness stops asserting anything about workspace schemas.
    // Not reading it is what stops the memo caching one workspace's answer for
    // the fleet during exactly the rolling migration it exists to catch.
    expect(await probe(true)).toEqual({ status: 200, calls: 0 })
    vi.resetModules()
  })
})
