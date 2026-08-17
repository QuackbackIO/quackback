/**
 * What the fleet serves for each way workspace resolution can fail.
 *
 * Every branch is a refusal. None degrades to a default workspace, and none
 * reaches a database it has not first been told it may reach. The suite asserts
 * the status code AND that the body carries no operator detail — a 503 that
 * leaks "settings.id is 019f… expected 019f…" to an anonymous visitor would be
 * an information leak about another workspace's identifiers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTITY_FAILURE_CODES, KEY_CUSTODY_FAILURE_CODES } from '../fingerprint'

const acquireScopeForHost = vi.fn()

vi.mock('@/lib/server/workspaces/resolver', () => ({ acquireScopeForHost }))

const silentLog = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

async function serve(
  host: string | null,
  options: { url?: string; method?: string } = {}
): Promise<Response | string> {
  const { resolveWorkspaceAndContinue } = await import('../request-scope')
  const request = new Request(options.url ?? 'http://example.com/anything', {
    method: options.method,
    headers: host === null ? {} : { host },
  })
  return resolveWorkspaceAndContinue({
    request,
    next: async () => 'served the workspace',
    log: silentLog as never,
  }) as Promise<Response | string>
}

describe('resolveWorkspaceAndContinue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.QUACKBACK_SAAS_FALLBACK_ORIGIN
    delete process.env.QUACKBACK_SAAS_RAILWAY_ORIGIN
    delete process.env.QUACKBACK_SAAS_EDGE_SECRET
  })

  it('serves the workspace inside the workspace scope when the record is good', async () => {
    const handle = { label: 'workspace-a' }
    const { createWorkspaceScope } = await import('../workspace-context')
    acquireScopeForHost.mockResolvedValue({
      kind: 'ok',
      // Built the way the real resolver builds it. A plain literal satisfies
      // `WorkspaceScope` now that secrets are off the shape, and `runWithWorkspaceScope`
      // refuses it — which is the point, and which a mock returning one would
      // otherwise hide behind a green test.
      scope: createWorkspaceScope({
        workspace: { workspaceKey: 'inst_a' },
        db: handle,
        sql: {},
        origin: 'request',
        secrets: { secretKey: 'd'.repeat(64), storage: null, storageProblem: 'not read here' },
      } as never),
    })

    const { getScopedDatabase } = await import('../workspace-context')
    const { resolveWorkspaceAndContinue } = await import('../request-scope')
    const seen: unknown[] = []
    const result = await resolveWorkspaceAndContinue({
      request: new Request('http://example.com/', { headers: { host: 't1.localhost' } }),
      next: async () => {
        seen.push(getScopedDatabase())
        return 'served'
      },
      log: silentLog as never,
    })

    expect(result).toBe('served')
    // The scope must be live INSIDE next(), which is the only place it matters.
    expect(seen).toEqual([handle])
  })

  it('resolves a third-party custom host from a signed customer-host header on a trusted origin', async () => {
    process.env.QUACKBACK_SAAS_FALLBACK_ORIGIN = 'saas-origin.quackback.co.uk'
    process.env.QUACKBACK_SAAS_EDGE_SECRET = 'test-edge-secret'
    const { signCustomerHost } = await import('../saas-edge-host')
    acquireScopeForHost.mockResolvedValue({
      kind: 'unknown_host',
      hostname: 't1a-cd.mortondev.com',
    })
    const { resolveWorkspaceAndContinue } = await import('../request-scope')
    await resolveWorkspaceAndContinue({
      request: new Request('http://saas-origin.quackback.co.uk/', {
        headers: {
          host: 'saas-origin.quackback.co.uk',
          'x-quackback-customer-host': 't1a-cd.mortondev.com',
          'x-quackback-customer-host-sig': signCustomerHost(
            'test-edge-secret',
            't1a-cd.mortondev.com'
          ),
        },
      }),
      next: async () => 'served',
      log: silentLog as never,
    })
    expect(acquireScopeForHost).toHaveBeenCalledWith('t1a-cd.mortondev.com', 'request')
  })

  it('ignores a spoofed customer-host header when the request Host is not a trusted origin', async () => {
    process.env.QUACKBACK_SAAS_FALLBACK_ORIGIN = 'saas-origin.quackback.co.uk'
    process.env.QUACKBACK_SAAS_EDGE_SECRET = 'test-edge-secret'
    const { signCustomerHost } = await import('../saas-edge-host')
    acquireScopeForHost.mockResolvedValue({ kind: 'unknown_host', hostname: 'south.example.com' })
    const { resolveWorkspaceAndContinue } = await import('../request-scope')
    await resolveWorkspaceAndContinue({
      request: new Request('http://south.example.com/', {
        headers: {
          host: 'south.example.com',
          'x-quackback-customer-host': 't1a-cd.mortondev.com',
          'x-quackback-customer-host-sig': signCustomerHost(
            'test-edge-secret',
            't1a-cd.mortondev.com'
          ),
        },
      }),
      next: async () => 'served',
      log: silentLog as never,
    })
    expect(acquireScopeForHost).toHaveBeenCalledWith('south.example.com', 'request')
  })

  it('ignores a customer-host header on the Railway origin when the HMAC is missing or wrong', async () => {
    process.env.QUACKBACK_SAAS_RAILWAY_ORIGIN = 'quackback-production-9e99.up.railway.app'
    process.env.QUACKBACK_SAAS_EDGE_SECRET = 'test-edge-secret'
    acquireScopeForHost.mockResolvedValue({
      kind: 'unknown_host',
      hostname: 'quackback-production-9e99.up.railway.app',
    })
    const { resolveWorkspaceAndContinue } = await import('../request-scope')
    await resolveWorkspaceAndContinue({
      request: new Request('http://quackback-production-9e99.up.railway.app/', {
        headers: {
          host: 'quackback-production-9e99.up.railway.app',
          'x-quackback-customer-host': 't1a-cd.mortondev.com',
          'x-quackback-customer-host-sig': '00'.repeat(32),
        },
      }),
      next: async () => 'served',
      log: silentLog as never,
    })
    expect(acquireScopeForHost).toHaveBeenCalledWith(
      'quackback-production-9e99.up.railway.app',
      'request'
    )
  })

  it('404s an unclaimed hostname without touching any database', async () => {
    acquireScopeForHost.mockResolvedValue({ kind: 'unknown_host', hostname: 'nope.example.com' })
    const res = (await serve('nope.example.com')) as Response
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['GET', 'HEAD'])(
    'redirects obsolete hosts for %s while preserving path and query',
    async (method) => {
      acquireScopeForHost.mockResolvedValue({
        kind: 'redirect',
        workspaceKey: 'inst_a',
        hostname: 'old.quackback.co.uk',
        location: 'https://new.quackback.co.uk',
      })
      const res = (await serve('old.quackback.co.uk', {
        method,
        url: 'http://old.quackback.co.uk/posts/one?sort=new',
      })) as Response
      expect(res.status).toBe(308)
      expect(res.headers.get('location')).toBe('https://new.quackback.co.uk/posts/one?sort=new')
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  )

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses unsafe %s on an obsolete host',
    async (method) => {
      acquireScopeForHost.mockResolvedValue({
        kind: 'redirect',
        workspaceKey: 'inst_a',
        hostname: 'old.quackback.co.uk',
        location: 'https://new.quackback.co.uk',
      })
      const res = (await serve('old.quackback.co.uk', { method })) as Response
      expect(res.status).toBe(409)
      expect(res.headers.get('location')).toBeNull()
    }
  )

  it('403s a suspended workspace and names the reason', async () => {
    acquireScopeForHost.mockResolvedValue({
      kind: 'suspended',
      workspaceKey: 'inst_a',
      hostname: 't1.localhost',
      reason: 'nonpayment',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('nonpayment')
  })

  it('410s a workspace being deleted', async () => {
    acquireScopeForHost.mockResolvedValue({
      kind: 'deleting',
      workspaceKey: 'inst_a',
      hostname: 't1.localhost',
    })
    expect(((await serve('t1.localhost')) as Response).status).toBe(410)
  })

  it('503s an invalid record and never degrades it to a default', async () => {
    acquireScopeForHost.mockResolvedValue({
      kind: 'invalid',
      workspaceKey: 'inst_a',
      hostname: 't1.localhost',
      problems: ['base URL host evil.example.com does not match primary hostname t1.localhost'],
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).not.toContain('evil.example.com')
  })

  it('503s a fingerprint refusal without leaking the identifiers to the visitor', async () => {
    acquireScopeForHost.mockResolvedValue({
      kind: 'refused',
      workspaceKey: 'inst_a',
      code: 'self_reported_workspace_id_mismatch',
      detail: 'settings.id is 019fe1d3-b692-7eeb-ab34-9a1d81f5b4f0, expected 019fe1ca-…',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).not.toContain('019fe1d3')
    expect(body).not.toContain('self_reported_workspace_id_mismatch')
    // The operator still gets the whole thing.
    expect(silentLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'self_reported_workspace_id_mismatch' }),
      expect.any(String)
    )
  })

  it('names a schema-floor refusal distinguishably from a fingerprint refusal', async () => {
    // Two refusals share the `refused` branch and mean opposite things. A
    // fingerprint refusal is "this is the wrong database" — a security event. A
    // schema-floor refusal is "this is the right database, mid-rollout" — routine
    // and this workspace's alone. Collapsing them would put every rollout in the
    // same alert stream as a cross-workspace near-miss.
    acquireScopeForHost.mockResolvedValue({
      kind: 'refused',
      workspaceKey: 'inst_a',
      code: 'schema_below_floor',
      detail: 'missing 1 migration(s): 0251_settings_cloud_tenant_id',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('30')
    const body = await res.text()
    expect(body).toContain('being updated')
    // Still no operator detail to the visitor.
    expect(body).not.toContain('0251_settings_cloud_tenant_id')
    // Warn, not error: this is expected during a rollout.
    expect(silentLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'schema_below_floor' }),
      expect.stringContaining('MIN_SCHEMA_VERSION')
    )
    expect(silentLog.error).not.toHaveBeenCalled()
  })

  it('a fingerprint refusal carries no Retry-After and is logged at error', async () => {
    // The control for the case above: if both produced the same response, the
    // assertion that they differ would be satisfied by neither being right.
    acquireScopeForHost.mockResolvedValue({
      kind: 'refused',
      workspaceKey: 'inst_a',
      code: 'neon_branch_mismatch',
      detail: 'branch br-x, expected br-y',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBeNull()
    expect(await res.text()).toContain('temporarily unavailable')
    expect(silentLog.error).toHaveBeenCalled()
  })

  it('a misconfigured MIN_SCHEMA_VERSION does not pull the cross-workspace alarm', async () => {
    // The measured failure this replaces: `MIN_SCHEMA_VERSION=9999` threw
    // UnknownSchemaVersion at pool checkout, which carried no `code`, so the
    // resolver labelled it `pool_unavailable` and it fell through this branch's
    // default into the fingerprint message — 503ing EVERY workspace, healthy ones
    // included, under the alarm reserved for a wrong-database near-miss.
    acquireScopeForHost.mockResolvedValue({
      kind: 'refused',
      workspaceKey: 'inst_a',
      code: 'schema_floor_misconfigured',
      detail: 'MIN_SCHEMA_VERSION=9999 names no bundled migration',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(503)
    const [, message] = silentLog.error.mock.calls.at(-1)!
    expect(message).toContain('misconfigured')
    expect(message).not.toContain('fingerprint')
  })

  it('a non-identity refusal is loud but is NOT reported as a fingerprint failure', async () => {
    // Every exception from pool checkout arrives in this branch. A missing
    // credential or an unreachable compute says nothing about WHICH database
    // was reached, so it must not be logged as though it did.
    for (const code of ['pool_unavailable', 'CONNECT_TIMEOUT', '28P01']) {
      silentLog.error.mockClear()
      acquireScopeForHost.mockResolvedValue({
        kind: 'refused',
        workspaceKey: 'inst_a',
        code,
        detail: 'connection refused',
      })
      const res = (await serve('t1.localhost')) as Response
      expect(res.status).toBe(503)
      const [, message] = silentLog.error.mock.calls.at(-1)!
      expect(message, `code ${code}`).not.toContain('fingerprint')
      expect(message).toContain('could not open a verified connection')
    }
  })

  it('every genuine identity failure DOES get the fingerprint message', async () => {
    // The other half, so the test above cannot pass by the message never being
    // emitted at all.
    for (const code of IDENTITY_FAILURE_CODES) {
      silentLog.error.mockClear()
      acquireScopeForHost.mockResolvedValue({
        kind: 'refused',
        workspaceKey: 'inst_a',
        code,
        detail: 'mismatch',
      })
      await serve('t1.localhost')
      const [, message] = silentLog.error.mock.calls.at(-1)!
      expect(message, `code ${code}`).toContain('fingerprint')
    }
  })

  it('a key-custody failure names the key, and does NOT pull the fingerprint alarm', async () => {
    // The database can be exactly the right one while the key is wrong, and the
    // repair for the two is nothing alike: a registry correction versus a
    // custody script. An operator reading a workspaces-breach alarm goes looking at
    // the registry, so routing a canary failure there sends them to the wrong
    // place with the right urgency.
    expect(KEY_CUSTODY_FAILURE_CODES.length).toBeGreaterThan(0)
    for (const code of KEY_CUSTODY_FAILURE_CODES) {
      silentLog.error.mockClear()
      acquireScopeForHost.mockResolvedValue({
        kind: 'refused',
        workspaceKey: 'inst_a',
        code,
        detail: 'canary could not be opened',
      })
      const res = (await serve('t1.localhost')) as Response
      expect(res.status).toBe(503)
      const [, message] = silentLog.error.mock.calls.at(-1)!
      expect(message, `code ${code}`).toContain('do not belong to each other')
      // Both poles. Without these it would pass while falling through to either
      // neighbouring branch, which is exactly the bug.
      expect(message, `code ${code}`).not.toContain('fingerprint')
      expect(message, `code ${code}`).not.toContain('could not open a verified connection')
    }
  })

  it('a stale-ciphertext refusal names the key, by that code and not by a list', async () => {
    // The loop above iterates a derived list, so it would keep passing if the
    // new code were never added to it. This names the code the stored-ciphertext
    // check produces, so the routing is asserted for that code specifically
    // rather than for whatever the list happens to hold.
    acquireScopeForHost.mockResolvedValue({
      kind: 'refused',
      workspaceKey: 'inst_a',
      code: 'secret_key_stored_ciphertext_mismatch',
      detail: 'the canary opens but jwks.private_key does not',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(503)
    const [, message] = silentLog.error.mock.calls.at(-1)!
    expect(message).toContain('do not belong to each other')
    expect(message).not.toContain('fingerprint')
    expect(message).not.toContain('could not open a verified connection')
    // And nothing operator-facing reaches the visitor.
    expect(await res.text()).not.toContain('jwks')
  })

  it('every failure code is classified as exactly one of the two subjects', async () => {
    // The compile-time map already forces a new code to be classified. This is
    // the runtime half: that the two derived lists partition it rather than
    // overlapping or leaving a gap, which is what would let a code reach the
    // catch-all branch while still being an identity failure.
    const both = IDENTITY_FAILURE_CODES.filter((c) => KEY_CUSTODY_FAILURE_CODES.includes(c))
    expect(both).toEqual([])
    expect(IDENTITY_FAILURE_CODES.length + KEY_CUSTODY_FAILURE_CODES.length).toBe(
      new Set([...IDENTITY_FAILURE_CODES, ...KEY_CUSTODY_FAILURE_CODES]).size
    )
  })

  it('never marks a refusal cacheable', async () => {
    // A cached 404 or 503 on a shared edge would pin a workspace into an outage
    // long after the record was fixed.
    for (const lookup of [
      { kind: 'unknown_host', hostname: 'x.example.com' },
      { kind: 'redirect', workspaceKey: 'a', hostname: 'x', location: 'https://y.example.com' },
      { kind: 'deleting', workspaceKey: 'a', hostname: 'x' },
      { kind: 'invalid', workspaceKey: 'a', hostname: 'x', problems: [] },
      { kind: 'refused', workspaceKey: 'a', code: 'c', detail: 'd' },
    ]) {
      acquireScopeForHost.mockResolvedValue(lookup)
      const res = (await serve('x.example.com')) as Response
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it.each(['/api/health', '/api/health/ready'])(
    'serves %s without resolving a workspace at all',
    async (path) => {
      // The platform hits these every couple of seconds, and on a wildcard
      // domain they arrive on a workspace hostname like everything else. Resolving
      // a workspace would open a pool and therefore WAKE A SUSPENDED COMPUTE, once
      // per probe, forever — silently destroying the idle-cost model that pool
      // eviction exists to protect. There is no functional symptom, which is
      // why it needs a test rather than an observation.
      acquireScopeForHost.mockResolvedValue({ kind: 'unknown_host', hostname: 'x' })
      const { resolveWorkspaceAndContinue } = await import('../request-scope')
      const result = await resolveWorkspaceAndContinue({
        request: new Request(`http://example.com${path}`, {
          headers: { host: 't1.localhost' },
        }),
        next: async () => 'probed',
        log: silentLog as never,
      })
      expect(result).toBe('probed')
      expect(acquireScopeForHost).not.toHaveBeenCalled()
    }
  )

  it('does NOT skip a path that merely starts like a health path', async () => {
    // A prefix match here would exempt `/api/healthcheck-for-workspace` — and an
    // exemption is a request served with no workspace, which under pooled workspaces
    // means `db` throws rather than serving the wrong thing, but is still a
    // route silently taken out of the workspace boundary.
    acquireScopeForHost.mockResolvedValue({ kind: 'unknown_host', hostname: 'x' })
    const { resolveWorkspaceAndContinue } = await import('../request-scope')
    const result = (await resolveWorkspaceAndContinue({
      request: new Request('http://example.com/api/health-report', {
        headers: { host: 't1.localhost' },
      }),
      next: async () => 'served',
      log: silentLog as never,
    })) as Response
    expect(acquireScopeForHost).toHaveBeenCalled()
    expect(result.status).toBe(404)
  })

  it('passes a missing Host header through the same refusal path', async () => {
    acquireScopeForHost.mockResolvedValue({ kind: 'unknown_host', hostname: '' })
    expect(((await serve(null)) as Response).status).toBe(404)
    // A null Host must still reach the resolver rather than short-circuit into
    // a default: the resolver is the only place the normalisation rules live.
    expect(acquireScopeForHost).toHaveBeenCalled()
  })
})
