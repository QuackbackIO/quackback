/**
 * What the fleet serves for each way tenant resolution can fail.
 *
 * Every branch is a refusal. None degrades to a default tenant, and none
 * reaches a database it has not first been told it may reach. The suite asserts
 * the status code AND that the body carries no operator detail — a 503 that
 * leaks "settings.id is 019f… expected 019f…" to an anonymous visitor would be
 * an information leak about another tenant's identifiers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const acquireScopeForHost = vi.fn()

vi.mock('@/lib/server/tenancy/resolver', () => ({ acquireScopeForHost }))

const silentLog = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

async function serve(host: string | null): Promise<Response | string> {
  const { resolveTenantAndContinue } = await import('../request-scope')
  const request = new Request('http://example.com/anything', {
    headers: host === null ? {} : { host },
  })
  return resolveTenantAndContinue({
    request,
    next: async () => 'served the workspace',
    log: silentLog as never,
  }) as Promise<Response | string>
}

describe('resolveTenantAndContinue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('serves the workspace inside the tenant scope when the record is good', async () => {
    const handle = { label: 'tenant-a' }
    acquireScopeForHost.mockResolvedValue({
      kind: 'ok',
      scope: { tenant: { tenantId: 'inst_a' }, db: handle, sql: {}, origin: 'request' },
    })

    const { getScopedDatabase } = await import('../tenant-context')
    const { resolveTenantAndContinue } = await import('../request-scope')
    const seen: unknown[] = []
    const result = await resolveTenantAndContinue({
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

  it('404s an unclaimed hostname without touching any database', async () => {
    acquireScopeForHost.mockResolvedValue({ kind: 'unknown_host', hostname: 'nope.example.com' })
    const res = (await serve('nope.example.com')) as Response
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('403s a suspended tenant and names the reason', async () => {
    acquireScopeForHost.mockResolvedValue({
      kind: 'suspended',
      tenantId: 'inst_a',
      hostname: 't1.localhost',
      reason: 'nonpayment',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('nonpayment')
  })

  it('410s a tenant being deleted', async () => {
    acquireScopeForHost.mockResolvedValue({
      kind: 'deleting',
      tenantId: 'inst_a',
      hostname: 't1.localhost',
    })
    expect(((await serve('t1.localhost')) as Response).status).toBe(410)
  })

  it('503s an invalid record and never degrades it to a default', async () => {
    acquireScopeForHost.mockResolvedValue({
      kind: 'invalid',
      tenantId: 'inst_a',
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
      tenantId: 'inst_a',
      code: 'workspace_id_mismatch',
      detail: 'settings.id is 019fe1d3-b692-7eeb-ab34-9a1d81f5b4f0, expected 019fe1ca-…',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).not.toContain('019fe1d3')
    expect(body).not.toContain('workspace_id_mismatch')
    // The operator still gets the whole thing.
    expect(silentLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'workspace_id_mismatch' }),
      expect.any(String)
    )
  })

  it('names a schema-floor refusal distinguishably from a fingerprint refusal', async () => {
    // Two refusals share the `refused` branch and mean opposite things. A
    // fingerprint refusal is "this is the wrong database" — a security event. A
    // schema-floor refusal is "this is the right database, mid-rollout" — routine
    // and this tenant's alone. Collapsing them would put every rollout in the
    // same alert stream as a cross-tenant near-miss.
    acquireScopeForHost.mockResolvedValue({
      kind: 'refused',
      tenantId: 'inst_a',
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
      tenantId: 'inst_a',
      code: 'neon_branch_mismatch',
      detail: 'branch br-x, expected br-y',
    })
    const res = (await serve('t1.localhost')) as Response
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBeNull()
    expect(await res.text()).toContain('temporarily unavailable')
    expect(silentLog.error).toHaveBeenCalled()
  })

  it('never marks a refusal cacheable', async () => {
    // A cached 404 or 503 on a shared edge would pin a tenant into an outage
    // long after the record was fixed.
    for (const lookup of [
      { kind: 'unknown_host', hostname: 'x.example.com' },
      { kind: 'deleting', tenantId: 'a', hostname: 'x' },
      { kind: 'invalid', tenantId: 'a', hostname: 'x', problems: [] },
      { kind: 'refused', tenantId: 'a', code: 'c', detail: 'd' },
    ]) {
      acquireScopeForHost.mockResolvedValue(lookup)
      const res = (await serve('x.example.com')) as Response
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it.each(['/api/health', '/api/health/ready'])(
    'serves %s without resolving a tenant at all',
    async (path) => {
      // The platform hits these every couple of seconds, and on a wildcard
      // domain they arrive on a tenant hostname like everything else. Resolving
      // a tenant would open a pool and therefore WAKE A SUSPENDED COMPUTE, once
      // per probe, forever — silently destroying the idle-cost model that pool
      // eviction exists to protect. There is no functional symptom, which is
      // why it needs a test rather than an observation.
      acquireScopeForHost.mockResolvedValue({ kind: 'unknown_host', hostname: 'x' })
      const { resolveTenantAndContinue } = await import('../request-scope')
      const result = await resolveTenantAndContinue({
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
    // A prefix match here would exempt `/api/healthcheck-for-tenant` — and an
    // exemption is a request served with no tenant, which under pooled tenancy
    // means `db` throws rather than serving the wrong thing, but is still a
    // route silently taken out of the tenant boundary.
    acquireScopeForHost.mockResolvedValue({ kind: 'unknown_host', hostname: 'x' })
    const { resolveTenantAndContinue } = await import('../request-scope')
    const result = (await resolveTenantAndContinue({
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
