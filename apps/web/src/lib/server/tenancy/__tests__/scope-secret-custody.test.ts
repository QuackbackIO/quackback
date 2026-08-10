/**
 * Who can reach a scope's secrets, and what a scope's existence proves.
 *
 * `TenantScope` used to carry `secrets: ResolvedTenantSecrets` as a public
 * field, so every holder of a scope held this workspace's `SECRET_KEY` **and**
 * its storage credential pair. Under SAAS-HOSTING-STACK.md §9 — one bucket for
 * the fleet, one credential, a per-workspace key prefix — that pair is an
 * addressing capability for the whole bucket, and the provider no longer
 * enforces the boundary the application now has to.
 *
 * The base branch made the storage client workspace-scoped and turned
 * `getS3Config()` module-private for exactly that reason. Leaving the same pair
 * on the scope would have moved the door rather than closed it: `getTenantScope`
 * is exported, and it answered the same question in one call.
 *
 * Two consumers have a real need. `secret-key.ts` wants the signing key;
 * `storage/s3.ts` wants the storage credential. Everything else that holds a
 * scope — the magic-link and claims stashes re-entering it, `sweep-lock`'s null
 * check, `storage/workspace-scope.ts`'s namespace read — wants the workspace's
 * identity. So each of the two gets an accessor that returns its own material
 * and no part of the other's, and neither returns a bucket.
 *
 * What must NOT change, and what these tests pin alongside the narrowing:
 *
 * - The secrets are resolved on the same pool-checkout pass as the fingerprint
 *   (§4.3, "atomically with `databaseUrl`"). Making the accessors async, or
 *   resolving lazily at the point of use, would reintroduce a mixed-up-credential
 *   class that is currently not expressible.
 * - The readers are synchronous. `activeSecretKey()` is called from session
 *   verification, token signing and `encryption.ts`; none of those can await.
 * - A scope existing at all means the `SECRET_KEY` half resolved. That was
 *   carried by the type, and the type is precisely what stops carrying it once
 *   `secrets` leaves the shape — so it is carried by the constructor now.
 */
import { describe, expect, it, vi } from 'vitest'

/** The fleet-wide value. Distinctive, so a leak of it into a scoped read is legible. */
const FLEET_SECRET_KEY = 'fleet-wide-secret-key-that-belongs-to-no-workspace'

vi.mock('@/lib/server/config', () => ({
  config: {
    secretKey: FLEET_SECRET_KEY,
    controlDatabaseUrl: 'postgresql://u@localhost:5432/control',
    tenantRegistryTtlMs: 5_000,
  },
}))

vi.mock('@/lib/server/logger', () => {
  const child = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), child })
  return { logger: { child } }
})

const acquireTenantPool = vi.fn()
vi.mock('../pool-cache', () => ({ acquireTenantPool }))

const {
  createTenantScope,
  getCurrentTenant,
  getTenantScope,
  getWorkspaceSecretKey,
  getWorkspaceStorageCredential,
  runWithTenantScope,
  TenantScopeSecretsMissingError,
} = await import('../tenant-context')
const { runWithLogContext } = await import('@/lib/server/log-context')
const { activeSecretKey } = await import('@/lib/server/secret-key')
const { makeTenantDescriptor, makeTenantSecrets, withTenant } =
  await import('@/lib/server/__tests__/tenant-scope')

const ALPHA = makeTenantSecrets('tenant-alpha')
const ALPHA_STORAGE = ALPHA.storage!
const ALPHA_BUCKET = makeTenantDescriptor('tenant-alpha').storage.bucket
const ALPHA_ENDPOINT = makeTenantDescriptor('tenant-alpha').storage.endpoint

/** A workspace whose storage credential reference did not resolve. */
const NO_STORAGE = {
  storage: null,
  storageProblem: 'derived+hkdf://… has no resolver in this process',
} as const

/**
 * Every string an ordinary reader can reach from `value`.
 *
 * Own enumerable string-keyed properties only, recursively — which is exactly
 * the surface a spread, a `JSON.stringify`, a structured log or a debugger walk
 * sees. It deliberately does NOT follow symbol keys: the secrets live under one,
 * so following it would flag the design rather than test it. The residual that
 * leaves is stated at the bottom of this file.
 */
function reachableStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object' || value === null) return []
  if (seen.has(value)) return []
  seen.add(value)
  return Object.values(value).flatMap((v) => reachableStrings(v, seen))
}

describe('the signing-key consumer still works', () => {
  it('reads this workspace’s own key inside a scope', () => {
    expect(withTenant('tenant-alpha', () => activeSecretKey())).toBe(ALPHA.secretKey)
  })

  it('gives two workspaces different keys from one process', () => {
    const alpha = withTenant('tenant-alpha', () => activeSecretKey())
    const bravo = withTenant('tenant-bravo', () => activeSecretKey())

    expect(alpha).not.toBe(bravo)
    // Neither is the fleet value. Without this the assertion above would also
    // pass for two workspaces that both fell back to something else entirely.
    expect([alpha, bravo]).not.toContain(FLEET_SECRET_KEY)
  })

  it('falls back to the process key with no scope, which is the self-hosted path', () => {
    expect(getWorkspaceSecretKey()).toBeNull()
    expect(activeSecretKey()).toBe(FLEET_SECRET_KEY)
  })
})

describe('the storage-credential consumer still works', () => {
  it('yields this workspace’s credential', () => {
    expect(withTenant('tenant-alpha', () => getWorkspaceStorageCredential())).toEqual({
      ok: true,
      credential: {
        accessKeyId: ALPHA_STORAGE.accessKeyId,
        secretAccessKey: ALPHA_STORAGE.secretAccessKey,
      },
    })
  })

  it('gives two workspaces different credentials from one process', () => {
    const alpha = withTenant('tenant-alpha', () => getWorkspaceStorageCredential())
    const bravo = withTenant('tenant-bravo', () => getWorkspaceStorageCredential())

    expect(alpha).not.toEqual(bravo)
  })

  it('reports why there is none rather than answering with something usable', () => {
    // The failure that matters is not "throws" — `s3.ts` turns this into a 503 —
    // it is that the operator-readable reason survives and no credential does.
    expect(
      withTenant('tenant-alpha', () => getWorkspaceStorageCredential(), { secrets: NO_STORAGE })
    ).toEqual({ ok: false, problem: NO_STORAGE.storageProblem })
  })

  it('tells "has none by design" apart from "did not resolve"', () => {
    // The third state, and the one that shipped broken. A workspace on the
    // fleet bucket carries no credential AND no problem, because its isolation
    // is the key prefix rather than a key pair. That must answer `null` — the
    // same as "no scope", since both mean "use the fleet credential" — and must
    // NOT answer `{ ok: false }`, which is what makes `s3.ts` return 503.
    //
    // Exactly this conflation reached production: the resolver stopped calling
    // absence a problem, and this door went on calling it one, so every request
    // answered 503 with nothing in the logs to say why.
    expect(
      withTenant('tenant-alpha', () => getWorkspaceStorageCredential(), {
        secrets: { storage: null, storageProblem: null },
      })
    ).toBeNull()
  })

  it('tells "no scope" apart from "did not resolve"', () => {
    // Two different questions with two different answers: the first falls back
    // to process configuration, the second must never. Collapsing them is how a
    // workspace whose reference failed would be served the fleet credential.
    expect(getWorkspaceStorageCredential()).toBeNull()
    expect(
      withTenant('tenant-alpha', () => getWorkspaceStorageCredential(), { secrets: NO_STORAGE })
    ).not.toBeNull()
  })

  it('hands back a copy, so a consumer cannot write through it onto the scope', () => {
    withTenant('tenant-alpha', () => {
      const first = getWorkspaceStorageCredential()
      expect(first?.ok).toBe(true)
      if (first?.ok !== true) return
      first.credential.secretAccessKey = 'tampered'

      const second = getWorkspaceStorageCredential()
      expect(second).toEqual({
        ok: true,
        credential: {
          accessKeyId: ALPHA_STORAGE.accessKeyId,
          secretAccessKey: ALPHA_STORAGE.secretAccessKey,
        },
      })
    })
  })
})

describe('neither accessor is a complete addressing capability on its own', () => {
  it('the storage credential arrives with no bucket, endpoint or region', () => {
    const reachable = reachableStrings(
      withTenant('tenant-alpha', () => getWorkspaceStorageCredential())
    )

    // Positive control: the walk really does see the credential, so the
    // exclusions below are not passing over an empty list.
    expect(reachable).toContain(ALPHA_STORAGE.secretAccessKey)
    expect(reachable).not.toContain(ALPHA_BUCKET)
    expect(reachable).not.toContain(ALPHA_ENDPOINT)
    // …and it carries no signing key either, so the storage module never holds
    // the value it has no use for.
    expect(reachable).not.toContain(ALPHA.secretKey)
  })

  it('the signing key arrives as a bare string, with no storage credential beside it', () => {
    const key = withTenant('tenant-alpha', () => getWorkspaceSecretKey())

    expect(key).toBe(ALPHA.secretKey)
    expect(typeof key).toBe('string')
    expect(reachableStrings(key)).not.toContain(ALPHA_STORAGE.secretAccessKey)
  })

  it('the bucket is still reachable, and only through the descriptor', () => {
    // Recorded rather than hidden. `TenantDescriptor.storage.bucket` stays on
    // the scope: a bucket name with no credential opens nothing, `buildPublicUrl`
    // needs it and must keep working for a workspace whose credential this
    // process cannot dereference, and under §9 it is one shared value that says
    // nothing about which workspace is asking. A determined caller inside the
    // process can still put these two calls together — that is the residual, and
    // it is two calls rather than one.
    const bucket = withTenant('tenant-alpha', () => getCurrentTenant()?.storage.bucket)

    expect(bucket).toBe(ALPHA_BUCKET)
    expect(reachableStrings(withTenant('tenant-alpha', () => getCurrentTenant()))).not.toContain(
      ALPHA_STORAGE.secretAccessKey
    )
  })
})

describe('what a scope hands its holder', () => {
  it('has no secrets field, by name', () => {
    withTenant('tenant-alpha', () => {
      const scope = getTenantScope()

      expect(scope).not.toHaveProperty('secrets')
      expect(Object.keys(scope!).sort()).toEqual(['db', 'origin', 'sql', 'tenant'])
    })
  })

  it('carries no secret material anywhere an ordinary reader can reach', () => {
    // The shape check behind the name check, so a re-attachment under some other
    // key — on the descriptor, beside it, at any depth — is caught too.
    withTenant('tenant-alpha', () => {
      const reachable = reachableStrings(getTenantScope())

      expect(reachable).not.toContain(ALPHA.secretKey)
      expect(reachable).not.toContain(ALPHA_STORAGE.secretAccessKey)
      expect(reachable).not.toContain(ALPHA_STORAGE.accessKeyId)
      // Positive control: the walk does reach the scope's own strings.
      expect(reachable).toContain('tenant-alpha')
    })
  })

  it('does not carry them through a spread or a JSON round trip either', () => {
    // The two ways a scope most plausibly ends up somewhere it was not meant to
    // go: copied into a wider object, or written to a log.
    withTenant('tenant-alpha', () => {
      const scope = getTenantScope()!
      const copied = { ...scope }
      const logged = JSON.stringify({ tenant: scope.tenant, origin: scope.origin })

      expect(reachableStrings(copied)).not.toContain(ALPHA_STORAGE.secretAccessKey)
      expect(reachableStrings(copied)).not.toContain(ALPHA.secretKey)
      expect(logged).not.toContain(ALPHA_STORAGE.secretAccessKey)
      expect(logged).not.toContain(ALPHA.secretKey)
    })
  })
})

describe('the readers stayed synchronous', () => {
  it('answers with a value, never a promise', () => {
    withTenant('tenant-alpha', () => {
      expect(getWorkspaceSecretKey()).toBeTypeOf('string')
      expect(activeSecretKey()).toBeTypeOf('string')
      expect(getWorkspaceStorageCredential()).not.toHaveProperty('then')
    })
  })

  it('declares no async reader, so one cannot appear without this failing', () => {
    // `db.ts`'s Proxy trap and every storage gate call these from places that
    // cannot await. An `async` here would typecheck and would be caught nowhere
    // else until a caller silently compared a Promise to a string.
    for (const fn of [getWorkspaceSecretKey, getWorkspaceStorageCredential, activeSecretKey]) {
      expect(fn.constructor.name, `${fn.name} is async`).toBe('Function')
    }
  })
})

describe('the secrets resolve at pool checkout, not at the point of use', () => {
  it('answers from the checkout value however many times it is read', async () => {
    // §4.3: the secrets are resolved atomically with the database handle, on the
    // pass that also runs the §3 fingerprint. The observable consequence is that
    // reading them costs nothing and reaches nothing — so the pool is checked out
    // once, before the scope exists, and never again on a read.
    const { acquireTenantScope } = await import('../resolver')
    const tenant = makeTenantDescriptor('tenant-alpha')
    acquireTenantPool.mockResolvedValueOnce({
      sql: {},
      db: {},
      secrets: makeTenantSecrets('tenant-alpha'),
    })
    acquireTenantPool.mockRejectedValue(new Error('checked out a second time'))

    const acquired = await acquireTenantScope(tenant, 'request')
    expect(acquired.kind).toBe('ok')
    if (acquired.kind !== 'ok') return

    const reads = runWithTenantScope(acquired.scope, () => [
      getWorkspaceSecretKey(),
      getWorkspaceSecretKey(),
      getWorkspaceStorageCredential(),
    ])

    expect(reads[0]).toBe(ALPHA.secretKey)
    expect(reads[1]).toBe(ALPHA.secretKey)
    expect(reads[2]).toEqual({
      ok: true,
      credential: {
        accessKeyId: ALPHA_STORAGE.accessKeyId,
        secretAccessKey: ALPHA_STORAGE.secretAccessKey,
      },
    })
    expect(acquireTenantPool).toHaveBeenCalledTimes(1)
  })
})

describe('a scope cannot exist without its SECRET_KEY having resolved', () => {
  const init = (secretKey: string) =>
    ({
      tenant: makeTenantDescriptor('tenant-alpha'),
      db: {},
      sql: {},
      origin: 'test',
      secrets: { secretKey, storage: null, storageProblem: 'not resolved' },
    }) as never

  it('CONTROL: builds one when the key resolved', () => {
    expect(() => createTenantScope(init('k'.repeat(64)))).not.toThrow()
  })

  it('refuses to build one when it did not', () => {
    expect(() => createTenantScope(init(''))).toThrow(TenantScopeSecretsMissingError)
  })

  it('refuses to make a hand-assembled object ambient', () => {
    // `TenantScope` no longer declares `secrets`, so this literal now satisfies
    // the type. The constructor is the only door, and this is what stops the
    // literal from getting through the wall instead.
    const literal = {
      tenant: makeTenantDescriptor('tenant-alpha'),
      db: {},
      sql: {},
      origin: 'test',
    } as never

    expect(() => runWithTenantScope(literal, () => 'ran')).toThrow(TenantScopeSecretsMissingError)
  })

  it('throws rather than reading the fleet key for a scope planted onto the store', () => {
    // Defence in depth, and the sharpest case: the alternative behaviour is to
    // answer null, and the null branch of `activeSecretKey()` is the fleet-wide
    // key. Serving that under a per-workspace scope writes this workspace's
    // ciphertext under a key that is not its own — silently, and only
    // discoverable when something later fails to decrypt.
    const carrier: Record<PropertyKey, unknown> = {}
    carrier[Symbol.for('quackback.tenantScope')] = {
      tenant: makeTenantDescriptor('tenant-alpha'),
      db: {},
      sql: {},
      origin: 'test',
    }

    runWithLogContext(carrier as never, () => {
      expect(getTenantScope()).not.toBeNull()
      expect(() => getWorkspaceSecretKey()).toThrow(TenantScopeSecretsMissingError)
      expect(() => activeSecretKey()).toThrow(TenantScopeSecretsMissingError)
      expect(() => getWorkspaceStorageCredential()).toThrow(TenantScopeSecretsMissingError)
    })
  })
})

describe('the export surface cannot re-widen', () => {
  it('no longer exports the accessor that handed out the whole bundle', async () => {
    // Named rather than only shape-checked, because this is the name a future
    // change reaches for when it wants "just the storage keys".
    const module = await import('../tenant-context')

    expect(module).not.toHaveProperty('getCurrentTenantSecrets')
  })

  it('has no nullary export that returns secret material, beyond the two accessors', async () => {
    // The shape check behind the name check, so a re-export under a new name is
    // caught too. Follows the seal the base branch added for `s3.ts`: every
    // nullary export is called under a real scope and its result inspected.
    const module = (await import('../tenant-context')) as Record<string, unknown>
    const allowed = new Set(['getWorkspaceSecretKey', 'getWorkspaceStorageCredential'])
    const material = [ALPHA.secretKey, ALPHA_STORAGE.accessKeyId, ALPHA_STORAGE.secretAccessKey]

    const nullary = Object.entries(module).filter(
      ([, value]) => typeof value === 'function' && (value as () => unknown).length === 0
    )
    expect(nullary.length).toBeGreaterThan(0)

    let exercised = 0
    for (const [name, fn] of nullary) {
      if (allowed.has(name)) {
        exercised += 1
        continue
      }
      const result = withTenant('tenant-alpha', () => (fn as () => unknown)())
      const reachable = reachableStrings(result)
      for (const secret of material) {
        expect(reachable, `${name} returns secret material`).not.toContain(secret)
      }
    }

    // The allowance has to have been spent on the two accessors that exist,
    // otherwise the loop above is asserting over a set that excludes them for
    // some other reason.
    expect(exercised).toBe(allowed.size)
  })

  it('keeps the two accessors off the tenancy module’s public face', async () => {
    // `secret-key.ts` and `storage/s3.ts` import them from `tenant-context`
    // directly. Adding them to the barrel would put the storage credential one
    // `@/lib/server/tenancy` import away from anything, which is the shape of
    // the leak being closed.
    const barrel = await import('../index')

    expect(barrel).not.toHaveProperty('getWorkspaceSecretKey')
    expect(barrel).not.toHaveProperty('getWorkspaceStorageCredential')
    expect(barrel).not.toHaveProperty('getCurrentTenantSecrets')
    // CONTROL: the barrel is the real one and does re-export the scope itself.
    expect(barrel).toHaveProperty('getTenantScope')
  })
})
