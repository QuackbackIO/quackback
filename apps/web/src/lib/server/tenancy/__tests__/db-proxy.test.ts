/**
 * The `db` Proxy trap: `this` binding, and what happens with no tenant.
 *
 * 537 files import `db`. None of them changes, which is only true because the
 * Proxy absorbs the difference — so the trap itself is the thing that has to be
 * right.
 *
 * Two properties, and both used to be untested:
 *
 * 1. **A method called on the proxy runs with the real handle as `this`.** The
 *    old trap returned the raw property, so `db.select(...)` ran with
 *    `this === proxy`. That worked only because `getDatabase()` returned one
 *    memoized singleton, which made the re-entrant lookups resolve to the same
 *    object anyway. Once the trap can return *different* handles, an unbound
 *    method would re-enter the trap for its own internals and could pick up a
 *    different tenant's session mid-statement.
 * 2. **Under pooled tenancy, no scope is an error, not a default.** There is no
 *    fleet-wide database to fall back to, and a fallback is how §3's failure
 *    mode — serving another tenant's data while every permission check passes —
 *    would come back in a new costume.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The config schema is strict, and this suite is about the trap rather than
 * about configuration, so give it a complete valid environment explicitly.
 * Vitest leaks Vite's own `BASE_URL=/` into `process.env`, which is not a URL,
 * so relying on ambient env here would make the suite pass or fail for reasons
 * unrelated to what it is testing.
 */
function stubBaseEnv(): void {
  vi.stubEnv('BASE_URL', 'http://localhost:3000')
  vi.stubEnv('SECRET_KEY', 'a'.repeat(64))
}

/**
 * The secrets every scope now has to be built with.
 *
 * This suite is about the trap, not about custody, but `createTenantScope()` is
 * the only door and it refuses a scope with no resolved `SECRET_KEY` — so a
 * fixture scope has to carry one, exactly as a real one does.
 */
const FIXTURE_SECRETS = {
  secretKey: 'f'.repeat(64),
  storage: null,
  storageProblem: 'this suite never touches storage',
}

/** A stand-in for a Drizzle handle that records what `this` was at call time. */
function makeHandle(label: string) {
  return {
    label,
    seenThis: null as unknown,
    plainValue: `value-of-${label}`,
    select(this: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this as any).seenThis = this
      return this
    },
  }
}

const singleHandle = makeHandle('single')

vi.mock('@quackback/db/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createDb: vi.fn(() => singleHandle),
    createDbFromSql: vi.fn(() => makeHandle('from-sql')),
  }
})

describe('db proxy — single tenancy', () => {
  beforeEach(() => {
    vi.resetModules()
    stubBaseEnv()
    vi.stubEnv('QUACKBACK_TENANCY', 'single')
    vi.stubEnv('DATABASE_URL', 'postgresql://u@localhost:5432/x')
    singleHandle.seenThis = null
    // The singleton is cached on globalThis across module reloads.
    delete (globalThis as { __db?: unknown }).__db
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete (globalThis as { __db?: unknown }).__db
  })

  it('binds methods to the resolved handle, not to the proxy', async () => {
    const { db } = await import('@/lib/server/db')
    const returned = (db as unknown as { select: () => unknown }).select()

    expect(singleHandle.seenThis).toBe(singleHandle)
    expect(returned).toBe(singleHandle)
    // The distinction the old trap got wrong: `this` must not be the proxy.
    expect(singleHandle.seenThis).not.toBe(db)
  })

  it('passes non-function properties straight through', async () => {
    const { db } = await import('@/lib/server/db')
    expect((db as unknown as { plainValue: string }).plainValue).toBe('value-of-single')
  })
})

describe('db proxy — pooled tenancy', () => {
  beforeEach(() => {
    vi.resetModules()
    stubBaseEnv()
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
    delete (globalThis as { __db?: unknown }).__db
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete (globalThis as { __db?: unknown }).__db
  })

  it('refuses to resolve a database with no tenant scope', async () => {
    const { db } = await import('@/lib/server/db')
    expect(() => (db as unknown as { select: () => unknown }).select).toThrow(
      /No tenant scope is active/
    )
  })

  it('never falls back to DATABASE_URL even when one is present in the environment', async () => {
    // The dangerous shape: a pooled fleet with a stray fleet-wide DSN. Config
    // refuses to boot with one, and the trap refuses independently — two
    // barriers, because this is the failure that looks correct.
    vi.stubEnv('DATABASE_URL', 'postgresql://u@localhost:5432/some-real-tenant')
    const { db } = await import('@/lib/server/db')
    expect(() => (db as unknown as { select: () => unknown }).select).toThrow()
  })

  it('resolves the active scope’s handle, bound', async () => {
    const { db } = await import('@/lib/server/db')
    const { createTenantScope, runWithTenantScope } =
      await import('@/lib/server/tenancy/tenant-context')

    const scopedHandle = makeHandle('tenant-a')
    const scope = createTenantScope({
      tenant: { tenantId: 'inst_a' },
      db: scopedHandle,
      sql: {},
      origin: 'test',
      secrets: FIXTURE_SECRETS,
    } as never)

    runWithTenantScope(scope, () => {
      const returned = (db as unknown as { select: () => unknown }).select()
      expect(scopedHandle.seenThis).toBe(scopedHandle)
      expect(returned).toBe(scopedHandle)
    })
  })

  it('resolves a DIFFERENT handle for a different tenant in the same process', async () => {
    // This is the whole piece in one assertion: one `db` import, two tenants,
    // two connections, decided by the ambient scope.
    const { db } = await import('@/lib/server/db')
    const { createTenantScope, runWithTenantScope } =
      await import('@/lib/server/tenancy/tenant-context')

    const a = makeHandle('tenant-a')
    const b = makeHandle('tenant-b')
    const scopeFor = (id: string, handle: unknown) =>
      createTenantScope({
        tenant: { tenantId: id },
        db: handle,
        sql: {},
        origin: 'test',
        secrets: FIXTURE_SECRETS,
      } as never)

    const seenA = runWithTenantScope(scopeFor('inst_a', a), () =>
      (db as unknown as { select: () => unknown }).select()
    )
    const seenB = runWithTenantScope(scopeFor('inst_b', b), () =>
      (db as unknown as { select: () => unknown }).select()
    )

    expect(seenA).toBe(a)
    expect(seenB).toBe(b)
    expect(seenA).not.toBe(seenB)
  })

  it('leaves the scope behind when the scope closes', async () => {
    const { db } = await import('@/lib/server/db')
    const { createTenantScope, runWithTenantScope } =
      await import('@/lib/server/tenancy/tenant-context')
    const a = makeHandle('tenant-a')

    runWithTenantScope(
      createTenantScope({
        tenant: { tenantId: 'inst_a' },
        db: a,
        sql: {},
        origin: 'test',
        secrets: FIXTURE_SECRETS,
      } as never),
      () => (db as unknown as { select: () => unknown }).select()
    )

    expect(() => (db as unknown as { select: () => unknown }).select).toThrow(
      /No tenant scope is active/
    )
  })

  it('survives an async body — the scope outlives the promise’s creation', async () => {
    // The trap that mutate-and-restore scoping falls into: a `finally` fires
    // when the promise is CREATED, so the scope would be gone before the first
    // query. AsyncLocalStorage.run is the only thing that scopes an async
    // subtree correctly.
    const { db } = await import('@/lib/server/db')
    const { createTenantScope, runWithTenantScope } =
      await import('@/lib/server/tenancy/tenant-context')
    const a = makeHandle('tenant-a')

    const result = await runWithTenantScope(
      createTenantScope({
        tenant: { tenantId: 'inst_a' },
        db: a,
        sql: {},
        origin: 'test',
        secrets: FIXTURE_SECRETS,
      } as never),
      async () => {
        await new Promise((r) => setTimeout(r, 10))
        return (db as unknown as { select: () => unknown }).select()
      }
    )

    expect(result).toBe(a)
  })

  it('refuses to re-scope an active context to a different tenant', async () => {
    const { createTenantScope, runWithTenantScope } =
      await import('@/lib/server/tenancy/tenant-context')
    const scopeFor = (id: string) =>
      createTenantScope({
        tenant: { tenantId: id },
        db: makeHandle(id),
        sql: {},
        origin: 'test',
        secrets: FIXTURE_SECRETS,
      } as never)

    expect(() =>
      runWithTenantScope(scopeFor('inst_a'), () =>
        runWithTenantScope(scopeFor('inst_b'), () => undefined)
      )
    ).toThrow(/Refusing to re-scope/)
  })
})
