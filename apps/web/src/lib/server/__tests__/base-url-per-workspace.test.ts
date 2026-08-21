/**
 * `config.baseUrl` under pooled workspaces — the §9 `BASE_URL` trap.
 *
 * Absolute URLs, cookie `secure` derivation and better-auth's trusted origins
 * all resolve from `config.baseUrl`. On a pooled fleet there is exactly one
 * `BASE_URL` and many workspaces, so a fleet-wide value means every workspace emits
 * links to somebody else's hostname — a live, customer-visible defect rather
 * than a tidiness item.
 *
 * These tests pin the getter rather than any call site, because the getter is
 * what makes the ~56 readers correct without touching them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Static, while every test below re-imports `runWithWorkspaceScope` after
// `vi.resetModules()`. That the two module instances still agree on one scope is
// the `Symbol.for` property `workspace-context.ts` documents, and it now covers the
// secrets slot as well as the scope slot.
import { createWorkspaceScope } from '@/lib/server/workspaces/workspace-context'

function stubBaseEnv(): void {
  // Vitest leaks Vite's own `BASE_URL=/` into process.env, which is not a URL.
  vi.stubEnv('BASE_URL', 'https://fleet.example.com')
  vi.stubEnv('SECRET_KEY', 'a'.repeat(64))
}

/**
 * A scope carrying only what `config.baseUrl` and the auth origin list read —
 * plus the secrets `createWorkspaceScope()` requires. This suite never reads them,
 * but a scope that could exist without a resolved `SECRET_KEY` is exactly what
 * the constructor refuses, so the fixture supplies one as a real scope does.
 */
function scopeFor(workspaceKey: string, primary: string, hostnames: string[] = [primary]) {
  return createWorkspaceScope({
    workspace: {
      workspaceKey,
      revision: 1,
      routing: { primaryHostname: primary, hostnames, baseUrl: `https://${primary}` },
    },
    db: {},
    sql: {},
    origin: 'test',
    secrets: { secretKey: 'b'.repeat(64), storage: null, storageProblem: 'not read here' },
  } as never)
}

describe('config.baseUrl', () => {
  beforeEach(() => {
    vi.resetModules()
    stubBaseEnv()
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is the workspace’s own pinned origin inside a workspace scope', async () => {
    const { config } = await import('@/lib/server/config')
    const { runWithWorkspaceScope } = await import('@/lib/server/workspaces/workspace-context')

    runWithWorkspaceScope(scopeFor('inst_t1', 'ws-t1.quackback.co.uk'), () => {
      expect(config.baseUrl).toBe('https://ws-t1.quackback.co.uk')
    })
    runWithWorkspaceScope(scopeFor('inst_t2', 'ws-t2.quackback.co.uk'), () => {
      expect(config.baseUrl).toBe('https://ws-t2.quackback.co.uk')
    })
  })

  it('gives two workspaces different origins from one process', async () => {
    const { config } = await import('@/lib/server/config')
    const { runWithWorkspaceScope } = await import('@/lib/server/workspaces/workspace-context')

    const seen: string[] = []
    runWithWorkspaceScope(scopeFor('inst_t1', 'a.example.com'), () => seen.push(config.baseUrl))
    runWithWorkspaceScope(scopeFor('inst_t2', 'b.example.com'), () => seen.push(config.baseUrl))

    expect(seen).toEqual(['https://a.example.com', 'https://b.example.com'])
    // The defect this replaces: both reading the one fleet value.
    expect(new Set(seen).size).toBe(2)
  })

  it('falls back to BASE_URL outside a workspace scope', async () => {
    const { config } = await import('@/lib/server/config')
    expect(config.baseUrl).toBe('https://fleet.example.com')
  })

  it('leaves a single-workspace install reading BASE_URL exactly as before', async () => {
    vi.resetModules()
    vi.stubEnv('QUACKBACK_TENANCY', 'single')
    vi.stubEnv('DATABASE_URL', 'postgresql://u@localhost:5432/x')
    vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', '')
    const { config } = await import('@/lib/server/config')
    expect(config.baseUrl).toBe('https://fleet.example.com')
  })
})

describe('a wildcard BASE_URL is refused', () => {
  beforeEach(() => {
    vi.resetModules()
    stubBaseEnv()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // `RAILWAY_PUBLIC_DOMAIN` becomes the literal string `*.quackback.co.uk` the
  // moment a wildcard custom domain is attached, and `deploy/railway-template.yml`
  // sets `BASE_URL: https://${{RAILWAY_PUBLIC_DOMAIN}}`. `new URL()` accepts it,
  // so without this check the only symptom is a dead link in a customer's inbox.
  /**
   * `loadConfig` keeps the detail out of the thrown message and logs it, so a
   * bare `toThrow()` would pass for any misconfiguration at all. Each case is
   * therefore a **paired control**: the same environment twice, differing only
   * in BASE_URL. If the accepted half also threw, the refusal would prove
   * nothing.
   */
  async function baseUrlOutcome(url: string, mode: string): Promise<'threw' | string> {
    vi.resetModules()
    vi.stubEnv('BASE_URL', url)
    vi.stubEnv('QUACKBACK_TENANCY', mode)
    if (mode === 'single') {
      vi.stubEnv('DATABASE_URL', 'postgresql://u@localhost:5432/x')
      vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', '')
    } else {
      vi.stubEnv('DATABASE_URL', '')
      vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
    }
    const { config } = await import('@/lib/server/config')
    try {
      return config.baseUrl
    } catch {
      return 'threw'
    }
  }

  it.each(['pooled', 'single'])(
    'refuses a wildcard and accepts the same fleet otherwise, under QUACKBACK_TENANCY=%s',
    async (mode) => {
      expect(await baseUrlOutcome('https://*.quackback.co.uk', mode)).toBe('threw')
      // The control: identical environment, real hostname.
      expect(await baseUrlOutcome('https://quackback-production-9e99.up.railway.app', mode)).toBe(
        'https://quackback-production-9e99.up.railway.app'
      )
    }
  )

  it('refuses a wildcard anywhere in the host, not just the first label', async () => {
    expect(await baseUrlOutcome('https://workspace.*.quackback.co.uk', 'single')).toBe('threw')
    expect(await baseUrlOutcome('https://a?b.quackback.co.uk', 'single')).toBe('threw')
  })
})
