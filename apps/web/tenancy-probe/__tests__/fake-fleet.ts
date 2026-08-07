/**
 * An in-process two-tenant fleet, with leaks that can be switched on.
 *
 * The suite's own claim is that it detects cross-tenant leaks. That claim has to
 * be tested against something that actually leaks — a probe suite validated only
 * against a correct system is validated against the one case where every
 * possible implementation passes.
 *
 * So this file implements just enough of the Quackback HTTP surface for the
 * probes to run, with a `leaks` switchboard that reproduces each hazard named in
 * SAAS-HOSTING-STACK.md §4: a shared session store, a shared storage secret, a
 * shared API-key table, a shared search index.
 */

import { createHmac } from 'node:crypto'
import { createTenantHttp, type FetchLike } from '../http'
import { createTripwire } from '../tripwire'
import type {
  ProbeConfig,
  ProbeContext,
  ProbeLogger,
  TenantDb,
  TenantHandle,
  TenantSlot,
  TripwireRecorder,
} from '../types'
import { CANARY, FIXTURE, fixturePostBody } from '../fixtures'

export interface FleetLeaks {
  /** Either tenant honours the other's session cookie / bearer token. */
  sharedSessionStore?: boolean
  /** Both tenants HMAC storage read tokens with the same secret. */
  sharedStorageSecret?: boolean
  /** Either tenant accepts the other's API key. */
  sharedApiKeys?: boolean
  /** Search on one tenant returns the other tenant's post. */
  sharedSearchIndex?: boolean
  /** Both tenants verify widget identify tokens with the same secret. */
  sharedWidgetSecret?: boolean
  /** Both tenants serve the same cached settings blob. */
  sharedSettingsCache?: boolean
  /** Nothing responds at all. */
  offline?: boolean
}

export interface FakeTenant {
  slot: TenantSlot
  origin: string
  workspaceSlug: string
  canary: string
  boardId: string
  postId: string
  adminUserId: string
  sessionToken: string
  apiKey: string
  storageSecret: string
  widgetSecret: string
  assistantPrincipalId: string
}

/**
 * Real, valid TypeIDs — not hand-typed lookalikes. `markerSearchForms` expands a
 * TypeID into its uuid form for database scanning, and a malformed id silently
 * skips that expansion, so a fixture that only looked like a TypeID would test
 * the harness against a case it never meets in production.
 */
const TENANT_IDS: Record<
  TenantSlot,
  Pick<FakeTenant, 'boardId' | 'postId' | 'adminUserId' | 'assistantPrincipalId'>
> = {
  alpha: {
    boardId: 'board_01kzf9qptsfez9r7tzffnppcw7',
    postId: 'post_01kzf9qptsfez9r7v4a96xm8fs',
    adminUserId: 'user_01kzf9qptsfez9r7vfr4anj508',
    assistantPrincipalId: 'principal_01kzf9qptsfez9r7vgxzydqhsb',
  },
  bravo: {
    boardId: 'board_01kzf9qptsfez9r7vs1cy0r0eb',
    postId: 'post_01kzf9qptsfez9r7w6rtffezwn',
    adminUserId: 'user_01kzf9qptsfez9r7wc5h4pxt0q',
    assistantPrincipalId: 'principal_01kzf9qptsfez9r7wqz0qta9zy',
  },
}

function makeTenant(slot: TenantSlot): FakeTenant {
  return {
    slot,
    origin: `https://${slot}.probe.test`,
    workspaceSlug: `${slot}-workspace`,
    canary: CANARY[slot],
    ...TENANT_IDS[slot],
    sessionToken: `sess-${slot}-token`,
    apiKey: `qb_${slot.padEnd(48, '0')}`,
    storageSecret: `s3-secret-${slot}`,
    widgetSecret: `wgt_${slot.padEnd(64, '0')}`,
  }
}

const SHARED_STORAGE_SECRET = 's3-secret-shared-bucket'
const SHARED_WIDGET_SECRET = `wgt_${'shared'.padEnd(64, '0')}`

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function storageSig(secret: string, key: string): string {
  return createHmac('sha256', secret).update(`read|${key}`).digest('hex').slice(0, 32)
}

function verifyJwt(secret: string, token: string): Record<string, unknown> | null {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) return null
  const expected = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  if (expected !== signature) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export class FakeFleet {
  readonly alpha = makeTenant('alpha')
  readonly bravo = makeTenant('bravo')

  constructor(readonly leaks: FleetLeaks = {}) {}

  private tenantFor(origin: string): FakeTenant | null {
    if (origin === this.alpha.origin) return this.alpha
    if (origin === this.bravo.origin) return this.bravo
    return null
  }

  private other(tenant: FakeTenant): FakeTenant {
    return tenant.slot === 'alpha' ? this.bravo : this.alpha
  }

  private storageSecretFor(tenant: FakeTenant): string {
    return this.leaks.sharedStorageSecret ? SHARED_STORAGE_SECRET : tenant.storageSecret
  }

  private widgetSecretFor(tenant: FakeTenant): string {
    return this.leaks.sharedWidgetSecret ? SHARED_WIDGET_SECRET : tenant.widgetSecret
  }

  /** The `storageSecret` an operator would hand the probe for this tenant. */
  publicStorageSecret(slot: TenantSlot): string {
    return this.storageSecretFor(slot === 'alpha' ? this.alpha : this.bravo)
  }

  publicWidgetSecret(slot: TenantSlot): string {
    return this.widgetSecretFor(slot === 'alpha' ? this.alpha : this.bravo)
  }

  readonly fetch: FetchLike = async (input, init) => {
    if (this.leaks.offline) throw new TypeError('fetch failed: connection refused')

    const url = new URL(typeof input === 'string' ? input : String(input))
    const tenant = this.tenantFor(url.origin)
    if (!tenant) return new Response('unknown host', { status: 502 })

    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers as HeadersInit)
    const cookie = headers.get('cookie') ?? ''
    const auth = headers.get('authorization') ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const path = url.pathname

    // ---- health ----------------------------------------------------------
    if (path === '/api/health/live') return json({ status: 'ok' })

    // ---- auth ------------------------------------------------------------
    if (path === '/api/auth/sign-in/email' && method === 'POST') {
      return json({ user: { id: tenant.adminUserId } }, 200, {
        'set-cookie': `better-auth.session_token=${tenant.sessionToken}.sig; Path=/; HttpOnly`,
      })
    }

    if (path === '/api/auth/get-session') {
      const presented =
        /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1]?.split('.')[0] ?? bearer
      const owner = this.sessionOwner(presented)
      if (!owner) return json(null)
      // A leaking fleet resolves the foreign session against THIS host's data,
      // which is exactly what a wrong-pool checkout looks like: a valid session
      // for the local identically-addressed admin.
      if (owner.slot !== tenant.slot && !this.leaks.sharedSessionStore) return json(null)
      const resolved = this.leaks.sharedSessionStore ? owner : tenant
      return json({ session: { userId: resolved.adminUserId }, user: { id: resolved.adminUserId } })
    }

    if (path === '/admin') {
      const presented = /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1]?.split('.')[0] ?? ''
      const owner = this.sessionOwner(presented)
      const leaking = this.leaks.sharedSessionStore && owner && owner.slot !== tenant.slot
      return new Response(
        `<html><body>admin shell ${leaking ? owner.canary : tenant.canary}</body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      )
    }

    // ---- REST API --------------------------------------------------------
    if (path.startsWith('/api/v1/')) {
      const keyOwner = this.apiKeyOwner(bearer)
      const accepted =
        keyOwner && (keyOwner.slot === tenant.slot || Boolean(this.leaks.sharedApiKeys))
      if (!accepted) {
        return json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid or missing API key.',
            },
          },
          401,
          { 'www-authenticate': 'Bearer realm="Quackback API"' }
        )
      }
      // Under `sharedApiKeys` the request is served by the LOCAL tenant, which
      // is the plausible-looking wrong answer.
      if (path === '/api/v1/boards' && method === 'GET') {
        return json({
          data: [{ id: tenant.boardId, slug: FIXTURE.boardSlug, name: FIXTURE.boardName }],
        })
      }
      if (path === '/api/v1/boards' && method === 'POST') {
        return json(
          { data: { id: tenant.boardId, slug: FIXTURE.boardSlug, name: FIXTURE.boardName } },
          201
        )
      }
      if (path === '/api/v1/posts' && method === 'GET') {
        const q = url.searchParams.get('search') ?? ''
        const matches = this.searchPosts(tenant, q)
        return json({ data: matches, meta: { pagination: { cursor: null, hasMore: false } } })
      }
      if (path === '/api/v1/posts' && method === 'POST') {
        return json({ data: { id: tenant.postId, title: FIXTURE.postTitle } }, 201)
      }
      if (path.startsWith('/api/v1/posts/') && method === 'PATCH') {
        return json({ data: { id: tenant.postId, title: FIXTURE.postTitle } })
      }
      return json({ error: { code: 'NOT_FOUND', message: 'no such endpoint' } }, 404)
    }

    // ---- storage ---------------------------------------------------------
    if (path.startsWith('/api/storage/')) {
      const key = decodeURIComponent(path.slice('/api/storage/'.length))
      const sig = url.searchParams.get('read')
      if (sig !== storageSig(this.storageSecretFor(tenant), key)) {
        return json({ error: 'Invalid storage read token' }, 403)
      }
      // Signature accepted; the object does not exist, so this falls through to
      // the object path exactly as the real handler does.
      return new Response(null, {
        status: 302,
        headers: { location: 'https://storage.test/object' },
      })
    }

    // ---- widget ----------------------------------------------------------
    if (path === '/api/widget/identify' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { ssoToken?: string }
      const claims = body.ssoToken ? verifyJwt(this.widgetSecretFor(tenant), body.ssoToken) : null
      if (!claims) return json({ error: { code: 'TOKEN_INVALID', message: 'bad token' } }, 400)
      return json({
        sessionToken: `widget-${tenant.slot}-session`,
        user: { id: `principal_widget_${tenant.slot}`, email: String(claims.email ?? '') },
        votedPostIds: [],
      })
    }

    if (path === '/api/widget/session') {
      const owner = bearer.startsWith('widget-alpha')
        ? this.alpha
        : bearer.startsWith('widget-bravo')
          ? this.bravo
          : null
      if (!owner) return json({ error: { code: 'AUTH_REQUIRED' } }, 401)
      if (owner.slot !== tenant.slot && !this.leaks.sharedSessionStore) {
        return json({ error: { code: 'AUTH_REQUIRED' } }, 401)
      }
      return json({ data: { user: { id: `principal_widget_${owner.slot}` } } })
    }

    if (path === '/api/widget/search') {
      const q = url.searchParams.get('q') ?? ''
      const posts = this.searchPosts(tenant, q).map((p) => ({
        id: p.id,
        title: p.title,
        board: { id: p.boardId, slug: FIXTURE.boardSlug },
      }))
      return json({ data: { posts } })
    }

    if (path === '/api/widget/config.json') {
      const source = this.leaks.sharedSettingsCache ? this.alpha : tenant
      return json({
        enabled: true,
        workspace: source.workspaceSlug,
        branding: { canary: source.canary },
      })
    }

    // ---- portal ----------------------------------------------------------
    if (path === '/' || path.startsWith('/b/')) {
      const source = this.leaks.sharedSettingsCache ? this.alpha : tenant
      const extra = this.leaks.sharedSearchIndex ? ` ${this.other(tenant).canary}` : ''
      return new Response(
        `<html><body>${source.workspaceSlug} ${source.canary}${extra}</body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      )
    }

    return new Response('not found', { status: 404 })
  }

  private sessionOwner(token: string): FakeTenant | null {
    if (!token) return null
    if (token === this.alpha.sessionToken) return this.alpha
    if (token === this.bravo.sessionToken) return this.bravo
    return null
  }

  private apiKeyOwner(key: string): FakeTenant | null {
    if (!key) return null
    if (key === this.alpha.apiKey) return this.alpha
    if (key === this.bravo.apiKey) return this.bravo
    return null
  }

  private searchPosts(
    tenant: FakeTenant,
    q: string
  ): Array<{ id: string; title: string; content: string; boardId: string }> {
    const candidates = this.leaks.sharedSearchIndex ? [this.alpha, this.bravo] : [tenant]
    const results: Array<{ id: string; title: string; content: string; boardId: string }> = []
    for (const owner of candidates) {
      const content = fixturePostBody(owner.slot)
      const haystack = `${FIXTURE.postTitle} ${content}`.toLowerCase()
      if (q && !haystack.includes(q.toLowerCase())) continue
      results.push({ id: owner.postId, title: FIXTURE.postTitle, content, boardId: owner.boardId })
    }
    return results
  }
}

/** A `TenantDb` backed by a fixed row set, for the database-dependent probes. */
export function fakeDb(
  slot: TenantSlot,
  rows: Record<string, Record<string, unknown>[]>
): TenantDb {
  return {
    slot,
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      for (const [needle, result] of Object.entries(rows)) {
        if (sql.includes(needle)) return result as T[]
      }
      return [] as T[]
    },
    async close() {},
  }
}

export const silentLogger: ProbeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export function baseConfig(fleet: FakeFleet, overrides: Partial<ProbeConfig> = {}): ProbeConfig {
  return {
    alphaUrl: fleet.alpha.origin,
    bravoUrl: fleet.bravo.origin,
    adminEmail: 'admin@example.com',
    adminPassword: 'password',
    alphaApiKey: fleet.alpha.apiKey,
    bravoApiKey: fleet.bravo.apiKey,
    alphaStorageSecret: fleet.publicStorageSecret('alpha'),
    bravoStorageSecret: fleet.publicStorageSecret('bravo'),
    alphaWidgetSecret: fleet.publicWidgetSecret('alpha'),
    bravoWidgetSecret: fleet.publicWidgetSecret('bravo'),
    allowBlocked: false,
    requestTimeoutMs: 5000,
    teardown: false,
    ...overrides,
  }
}

export interface TestContext extends ProbeContext {
  tripwire: TripwireRecorder
}

/** Build a `ProbeContext` wired to the fake fleet, with the fixture pre-populated. */
export function makeContext(fleet: FakeFleet, config = baseConfig(fleet)): TestContext {
  const markers = (t: FakeTenant) => ({
    slot: t.slot,
    canary: t.canary,
    ids: { boardId: t.boardId, postId: t.postId, adminUserId: t.adminUserId },
  })

  const tripwire = createTripwire(markers(fleet.alpha), markers(fleet.bravo))

  const build = (t: FakeTenant): TenantHandle => ({
    slot: t.slot,
    baseUrl: t.origin,
    markers: markers(t),
    http: createTenantHttp({
      slot: t.slot,
      baseUrl: t.origin,
      tripwire,
      defaultTimeoutMs: config.requestTimeoutMs,
      fetchImpl: fleet.fetch,
    }),
    adminCookies: `better-auth.session_token=${t.sessionToken}.sig`,
    fixture: {
      workspaceName: t.workspaceSlug,
      adminEmail: config.adminEmail,
      adminUserId: t.adminUserId,
      adminPrincipalId: '',
      boardId: t.boardId,
      boardSlug: FIXTURE.boardSlug,
      boardTitle: FIXTURE.boardName,
      postId: t.postId,
      postTitle: FIXTURE.postTitle,
      postBody: fixturePostBody(t.slot),
    },
  })

  const alpha = build(fleet.alpha)
  const bravo = build(fleet.bravo)

  return {
    config,
    alpha,
    bravo,
    tripwire,
    capabilities: new Set(['http', 'admin', 'api-key', 'storage-secret', 'widget-secret']),
    log: silentLogger,
    newClient(handle: TenantHandle) {
      return createTenantHttp({
        slot: handle.slot,
        baseUrl: handle.baseUrl,
        tripwire,
        defaultTimeoutMs: config.requestTimeoutMs,
        fetchImpl: fleet.fetch,
      })
    },
  }
}
