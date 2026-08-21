/**
 * The active tenant, carried on the request-scoped AsyncLocalStorage store.
 *
 * Tenant resolution happens once, from the Host
 * header, before auth runs — auth is itself full of `db` queries, so a tenant
 * decided "once auth resolves" is decided far too late to route the database.
 *
 * The store already exists. `middleware/request-context.ts` opens a
 * `runWithLogContext` object at the very start of every SSR document, server
 * route and server function, and `functions/auth-request-cache.ts` already
 * demonstrates hanging request-scoped state off it under a symbol key. This is
 * the same mechanism, one field wider.
 *
 * Two properties matter and both are load-bearing:
 *
 * 1. **Synchronous read.** `db.ts`'s Proxy trap is synchronous, so the resolved
 *    Drizzle handle has to already be sitting in the store by the time any call
 *    site touches `db`. Acquisition is async and happens in the middleware;
 *    everything downstream just reads.
 * 2. **Absence is an error, not a default.** Under pooled tenancy there is no
 *    fleet-wide database to fall back to, and a fallback is exactly how §3's
 *    failure mode — serving another tenant's data while every permission check
 *    passes — would come back.
 */
import type { Database } from '@quackback/db/client'
import type { Sql } from 'postgres'
import { getLogContext, runWithLogContext, setLogContext } from '@/lib/server/log-context'
import type { TenantDescriptor } from './registry'
import type {
  ResolvedTenantSecrets,
  TenantStorageCredentials,
} from './vendor/tenant-secret-resolution'

/**
 * `Symbol.for` rather than a module-private symbol: the dev server can evaluate
 * a module twice across the SSR/route graph, and two private symbols would give
 * the middleware and the `db` trap two different slots on the same store.
 */
const TENANT_SCOPE_KEY = Symbol.for('quackback.tenantScope')

/**
 * Where a scope's secrets actually sit.
 *
 * Same `Symbol.for` reasoning as {@link TENANT_SCOPE_KEY}, and for a sharper
 * reason: a module-private symbol under double evaluation would let the reader
 * find a scope but not its `SECRET_KEY`, and the reader's null branch is
 * `config.secretKey` — a silent fleet-wide key under a per-tenant scope, which
 * is the one outcome `secret-key.ts` exists to make impossible.
 *
 * Non-enumerable, so the property survives neither a spread, a `JSON.stringify`,
 * an `Object.keys` walk nor a structured log of the scope. It is reachable by
 * anyone who computes the same `Symbol.for` — see the seal suite's closing note.
 */
const SCOPE_SECRETS_KEY = Symbol.for('quackback.tenantScope.secrets')

/** Why a scope exists. Only for logging and the scope audit; never a policy input. */
export type TenantScopeOrigin =
  | 'request'
  | 'sweep'
  | 'queue'
  | 'relay'
  | 'script'
  | 'migration'
  | 'test'

/**
 * The scope every caller sees: which tenant, which database, why.
 *
 * **No secrets on the shape, and none on the object.** This tenant's
 * `SECRET_KEY` and storage credentials are still resolved on the same
 * pool-checkout pass as the fingerprint and still ride on the scope — that is
 * what lets the synchronous readers (`activeSecretKey`, every storage gate)
 * answer without awaiting, and it is why a scope existing at all means the
 * `SECRET_KEY` half resolved. What changed is who can reach them: they sit
 * under {@link SCOPE_SECRETS_KEY}, and the only things that read that slot are
 * the two purpose-named accessors below.
 *
 * The shape this replaces handed every holder of a scope the storage credential
 * pair, which under one fleet bucket is an addressing capability for the whole
 * bucket. Of the callers that hold a scope, two want secrets and the rest want
 * the tenant's identity or a null check.
 *
 * Build one with {@link createTenantScope}. A plain object literal is not a
 * scope: {@link runWithTenantScope} refuses it.
 */
export interface TenantScope {
  readonly tenant: TenantDescriptor
  /** Drizzle handle bound to this tenant's pool. What `db` resolves to. */
  readonly db: Database
  /** The underlying postgres.js handle, for raw/session-level work. */
  readonly sql: Sql
  readonly origin: TenantScopeOrigin
}

/**
 * What a scope is built from. `secrets` is an **input**, never a field.
 *
 * Spelled as a separate type rather than `TenantScope & { secrets }` so that
 * widening `TenantScope` back to carry secrets cannot happen by editing one
 * interface: the constructor would still have to be changed to copy them onto
 * the object, and the seal suite calls every nullary export to check nothing
 * does.
 */
export interface TenantScopeInit {
  readonly tenant: TenantDescriptor
  readonly db: Database
  readonly sql: Sql
  readonly origin: TenantScopeOrigin
  /**
   * Resolved on this checkout — `tenancy/tenant-secrets.ts`. Required, because
   * "a scope exists" is the fact the rest of the app reads as "this tenant's
   * `SECRET_KEY` resolved".
   */
  readonly secrets: ResolvedTenantSecrets
}

export class TenantScopeMissingError extends Error {
  constructor(detail: string) {
    super(
      `No tenant scope is active. ${detail} ` +
        'Under QUACKBACK_TENANCY=pooled every database access must run inside ' +
        'runWithTenantScope() — a request scope opened by the tenant middleware, ' +
        'or an explicit scope opened by a background subsystem.'
    )
    this.name = 'TenantScopeMissingError'
  }
}

/** A scope was made ambient without the secrets a scope is supposed to prove. */
export class TenantScopeSecretsMissingError extends Error {
  constructor(tenantId: string) {
    super(
      `The scope for tenant ${tenantId} carries no resolved secrets. Only ` +
        'createTenantScope() can build a scope, and it requires a resolved SECRET_KEY, ' +
        'so this one was assembled as a plain object. Serving it would read the ' +
        'fleet-wide SECRET_KEY under a per-tenant scope and write this tenant’s ' +
        'ciphertext under a key that is not its own.'
    )
    this.name = 'TenantScopeSecretsMissingError'
  }
}

type ScopeCarrier = Record<PropertyKey, unknown>

/**
 * Build a scope. The only thing that can.
 *
 * Refusing an unresolved `SECRET_KEY` here is what makes "a scope exists" mean
 * "this tenant's key resolved" at runtime rather than only in the type. It was
 * the type that carried that guarantee before, and the type is exactly what
 * stops carrying it once `secrets` leaves the shape.
 */
export function createTenantScope(init: TenantScopeInit): TenantScope {
  if (typeof init.secrets?.secretKey !== 'string' || init.secrets.secretKey === '') {
    throw new TenantScopeSecretsMissingError(init.tenant.tenantId)
  }
  const scope: TenantScope = {
    tenant: init.tenant,
    db: init.db,
    sql: init.sql,
    origin: init.origin,
  }
  Object.defineProperty(scope, SCOPE_SECRETS_KEY, {
    value: init.secrets,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return Object.freeze(scope)
}

/**
 * The secrets a scope carries. Module-private, and the only reader of the slot.
 *
 * Null means "no scope" — the self-hosted path, where the callers fall back to
 * process configuration. A scope that exists but holds nothing is not a null;
 * it throws, because the null branch of both callers is a fleet-wide value and
 * answering it for a tenant is the failure this module is built to refuse.
 */
function scopeSecrets(scope: TenantScope | null): ResolvedTenantSecrets | null {
  if (!scope) return null
  const held = (scope as unknown as ScopeCarrier)[SCOPE_SECRETS_KEY] as
    | ResolvedTenantSecrets
    | undefined
  if (!held) throw new TenantScopeSecretsMissingError(scope.tenant.tenantId)
  return held
}

/** The active tenant scope, or null outside one. */
export function getTenantScope(): TenantScope | null {
  const store = getLogContext() as ScopeCarrier | undefined
  if (!store) return null
  return (store[TENANT_SCOPE_KEY] as TenantScope | undefined) ?? null
}

/** The active tenant scope, or throw. */
export function requireTenantScope(
  detail = 'A tenant-scoped operation was attempted.'
): TenantScope {
  const scope = getTenantScope()
  if (!scope) throw new TenantScopeMissingError(detail)
  return scope
}

/**
 * The Drizzle handle for the active tenant, or null.
 *
 * Deliberately non-throwing and dependency-free: this is what `db.ts`'s Proxy
 * trap calls on every property access, and it must not be able to fail for a
 * single-tenant install that has no tenancy configured at all.
 */
export function getScopedDatabase(): Database | null {
  return getTenantScope()?.db ?? null
}

/** The active tenant record, or null. Safe to call from single-tenant code. */
export function getCurrentTenant(): TenantDescriptor | null {
  return getTenantScope()?.tenant ?? null
}

/**
 * The active workspace's `SECRET_KEY`, or null outside a scope.
 *
 * One of the two ways out of the secrets slot, and it yields a single string:
 * no bucket, no endpoint, no storage credential. `secret-key.ts` is the only
 * caller, and `activeSecretKey()` is the only thing the rest of the app sees.
 *
 * Null means "single tenant", not "unresolved": a scope cannot be created
 * without a resolved `SECRET_KEY`. Callers read `config.secretKey` on null,
 * which is the self-hosted path and is unchanged.
 *
 * Synchronous, and it must stay that way. `activeSecretKey()` is called from
 * session verification, token signing and `encryption.ts` — hundreds of sites
 * that cannot await — which is why the value is resolved at pool checkout and
 * carried, rather than fetched here.
 */
export function getWorkspaceSecretKey(): string | null {
  return scopeSecrets(getTenantScope())?.secretKey ?? null
}

/**
 * The active workspace's storage credential, or why there is none.
 *
 * The other way out of the slot, and deliberately **not** a way to address an
 * object: it carries no bucket, no endpoint and no region. Those live on the
 * descriptor and are reached through `getCurrentTenant()`, so no single call
 * hands back a credential and the thing it opens. It carries no `SECRET_KEY`
 * either, so the storage module never holds the session key it has no use for.
 *
 * `null` is "no scope" and is distinct from `{ ok: false }`, which is "this
 * workspace's credential reference did not resolve". They are different
 * questions with different answers: the first falls back to process
 * configuration, the second must never.
 */
export type WorkspaceStorageCredential =
  | { readonly ok: true; readonly credential: TenantStorageCredentials }
  | { readonly ok: false; readonly problem: string }

export function getWorkspaceStorageCredential(): WorkspaceStorageCredential | null {
  const secrets = scopeSecrets(getTenantScope())
  if (!secrets) return null
  if (!secrets.storage) {
    // No credential AND no problem is the pooled default, not a failure: a
    // workspace on the fleet bucket has none of its own because its isolation
    // is the key prefix. `null` means "nothing workspace-specific here", which
    // is what both callers already want — `resolveStorageCredentials` falls
    // back to the fleet credential and `isS3Usable` stays true.
    //
    // Reporting it as `{ ok: false }` is what made every request answer 503
    // after the credential ref was dropped: the resolver had stopped calling it
    // a problem and this door started calling it one again.
    if (secrets.storageProblem === null) return null
    return { ok: false, problem: secrets.storageProblem }
  }
  // Copied rather than handed out by reference: the scope's own credential is
  // frozen to everything that cannot reach the slot, and returning the live
  // object would quietly make it writable again through this door.
  return {
    ok: true,
    credential: {
      accessKeyId: secrets.storage.accessKeyId,
      secretAccessKey: secrets.storage.secretAccessKey,
    },
  }
}

/**
 * Run `fn` with `scope` as the ambient tenant.
 *
 * Always opens a **nested** AsyncLocalStorage run rather than mutating the
 * enclosing store. Mutate-and-restore looks cheaper and is wrong: `fn` is
 * usually async, so a `finally` fires when the promise is *created*, not when
 * it settles — the scope would vanish before the first query. `ALS.run` is the
 * only thing that scopes an async subtree correctly.
 *
 * The parent's fields (`request_id`, `route`) are copied forward so log
 * correlation survives the nesting. On the background paths there is no parent,
 * so a fresh correlated context is opened — which is how a sweeper gets a
 * request id for free once it is scoped.
 *
 * Nesting a *different* tenant inside an existing scope is refused. It has no
 * legitimate use, and permitting it would mean a helper could quietly re-point
 * the database mid-request.
 *
 * A scope that carries no secrets is refused here too, at the door rather than
 * at the first `activeSecretKey()` deep inside auth. `TenantScope` no longer
 * declares `secrets`, so an object literal now satisfies the type; this is what
 * stops it satisfying the system.
 */
export function runWithTenantScope<T>(scope: TenantScope, fn: () => T): T {
  scopeSecrets(scope)
  const parent = getLogContext() as ScopeCarrier | undefined
  const existing = parent?.[TENANT_SCOPE_KEY] as TenantScope | undefined
  if (existing && existing.tenant.tenantId !== scope.tenant.tenantId) {
    throw new Error(
      `Refusing to re-scope an active context from tenant ${existing.tenant.tenantId} ` +
        `to ${scope.tenant.tenantId}.`
    )
  }

  const child: ScopeCarrier = {
    request_id: (parent?.request_id as string | undefined) ?? crypto.randomUUID(),
    route: (parent?.route as string | undefined) ?? `${scope.origin}:${scope.tenant.tenantId}`,
    ...(parent ?? {}),
    tenant_id: scope.tenant.tenantId,
  }
  child[TENANT_SCOPE_KEY] = scope

  // Stamp the tenant onto the PARENT too, so the enclosing access log — emitted
  // after this scope has closed — still says which tenant it served.
  if (parent) setLogContext({ tenant_id: scope.tenant.tenantId })

  return runWithLogContext(child as never, fn)
}
