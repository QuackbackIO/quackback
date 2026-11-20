/**
 * Helpers for the portal and team sign-in journeys (PPL-AUTH, e2e/tests/people/auth-*.spec.ts).
 *
 * Rate limits shape everything here:
 * - Our own limiters (rate_bucket table) key on the client address plus the
 *   email, and the library's in-memory per-IP limits (sign-in/up 3 per 10 s,
 *   magic-link verify 5 per 60 s, password reset 3 per 60 s) cannot be reset
 *   over HTTP. Both read the address from `x-e2e-client-ip` (support.env sets
 *   TRUSTED_CLIENT_IP_HEADER; the app copies it into the header the library
 *   reads), so every request context and browser context made here gets its
 *   own random address. Never share one between tests.
 * - Fresh `<marker>...@customers.example` addresses keep the per-address
 *   buckets private as well.
 */
import type {
  APIRequestContext,
  APIResponse,
  Browser,
  BrowserContext,
  Page,
  PlaywrightWorkerArgs,
} from '@playwright/test'
import { createHmac } from 'node:crypto'
import { test as base, expect } from '../support/fixtures'
import { clientIp } from '../support/api-client'
import { ISOLATED } from '../support/automation'
import { pollFor, supportDb } from '../support/db'
import { supportEnv } from '../support/env'
import { bustSettingsCache } from '../support/isolated-settings'
import { getMail, linksIn, mailTo, type MailpitMessage } from '../support/mailpit'

export { expect }

export const WORKSPACE = 'Acme Corp'
export const PASSWORD = 'correct-horse-battery-1'

export function baseUrl(): string {
  return supportEnv().baseUrl
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238: SHA-1, 30 s, 6 digits), as an authenticator app computes it
// ---------------------------------------------------------------------------

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(ch)
    if (v < 0) throw new Error(`not base32: ${ch}`)
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** The current code for a base32 secret (or an otpauth:// URI). */
export function totp(secretOrUri: string, at = Date.now()): string {
  const secret = secretOrUri.startsWith('otpauth://')
    ? (new URL(secretOrUri).searchParams.get('secret') ?? '')
    : secretOrUri
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = mac[mac.length - 1] & 0xf
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(value).padStart(6, '0')
}

/**
 * Turn on two-factor for the signed-in person behind `api` through the
 * library's endpoints (what the profile page calls). Returns the otpauth URI
 * and the backup codes.
 */
export async function enrollTwoFactor(
  api: APIRequestContext,
  password = PASSWORD
): Promise<{ totpURI: string; backupCodes: string[] }> {
  const enable = await api.post('/api/auth/two-factor/enable', { data: { password } })
  expect(enable.status(), await enable.text()).toBe(200)
  const body = (await enable.json()) as { totpURI: string; backupCodes: string[] }
  const verify = await api.post('/api/auth/two-factor/verify-totp', {
    data: { code: await freshTotp(body.totpURI) },
  })
  expect(verify.status(), await verify.text()).toBe(200)
  return body
}

/** A code with at least 5 s left in its window (waits past a boundary). */
export async function freshTotp(secretOrUri: string): Promise<string> {
  const left = 30_000 - (Date.now() % 30_000)
  if (left < 5_000) await new Promise((r) => setTimeout(r, left + 250))
  return totp(secretOrUri)
}

// ---------------------------------------------------------------------------
// Request and browser contexts with their own client address
// ---------------------------------------------------------------------------

type ApiContextOptions = NonNullable<
  Parameters<PlaywrightWorkerArgs['playwright']['request']['newContext']>[0]
>

/** A cookie-jar request context with its own client address and the app's Origin. */
export async function anonApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  opts: { ip?: string; storageState?: ApiContextOptions['storageState'] } = {}
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-e2e-client-ip': opts.ip ?? clientIp(), origin: baseUrl() },
    storageState: opts.storageState,
  })
}

/** A fresh browser context (no session) with its own client address. */
export async function visitorContext(
  browser: Browser,
  opts: { ip?: string; storageState?: Awaited<ReturnType<BrowserContext['storageState']>> } = {}
): Promise<BrowserContext> {
  return browser.newContext({
    extraHTTPHeaders: { 'x-e2e-client-ip': opts.ip ?? clientIp() },
    storageState: opts.storageState,
  })
}

interface AuthFixtures {
  /** A request context with no session and its own client address. */
  anon: APIRequestContext
  /** A new signed-out browser page with its own client address. */
  visitor: () => Promise<Page>
  /** Make a request context (closed after the test). */
  newApi: (opts?: { ip?: string }) => Promise<APIRequestContext>
}

/** The support `test` plus per-test signed-out contexts with private addresses. */
export const test = base.extend<AuthFixtures>({
  anon: async ({ playwright }, use) => {
    const api = await anonApi(playwright)
    await use(api)
    await api.dispose()
  },
  visitor: async ({ browser }, use) => {
    const contexts: BrowserContext[] = []
    await use(async () => {
      const context = await visitorContext(browser)
      contexts.push(context)
      return context.newPage()
    })
    for (const c of contexts) await c.close().catch(() => {})
  },
  newApi: async ({ playwright }, use) => {
    const made: APIRequestContext[] = []
    await use(async (opts = {}) => {
      const api = await anonApi(playwright, opts)
      made.push(api)
      return api
    })
    for (const a of made) await a.dispose().catch(() => {})
  },
})

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

export function signUp(
  api: APIRequestContext,
  email: string,
  password = PASSWORD,
  name = ''
): Promise<APIResponse> {
  return api.post('/api/auth/sign-up/email', {
    data: { email, password, name },
    maxRedirects: 0,
  })
}

export function signIn(
  api: APIRequestContext,
  email: string,
  password = PASSWORD
): Promise<APIResponse> {
  return api.post('/api/auth/sign-in/email', { data: { email, password }, maxRedirects: 0 })
}

/** What the dialog's "Continue with email" calls: one mail with a link and a code. */
export function portalSignin(
  api: APIRequestContext,
  email: string,
  callbackURL?: string
): Promise<APIResponse> {
  return api.post('/api/auth/portal-signin', {
    data: callbackURL === undefined ? { email } : { email, callbackURL },
  })
}

export async function getSession(
  api: APIRequestContext
): Promise<{ user: { id: string; email: string } } | null> {
  const res = await api.get('/api/auth/get-session')
  expect(res.status()).toBe(200)
  const text = await res.text()
  return text && text !== 'null'
    ? (JSON.parse(text) as { user: { id: string; email: string } })
    : null
}

/** A portal account made by password sign-up through the API (own address). */
export async function portalUser(
  playwright: PlaywrightWorkerArgs['playwright'],
  email: string,
  password = PASSWORD
): Promise<{ email: string; password: string; userId: string }> {
  const api = await anonApi(playwright)
  try {
    const res = await signUp(api, email, password, 'Portal Person')
    expect(res.status(), await res.text()).toBe(200)
    const user = await userRow(email)
    if (!user) throw new Error(`no user for ${email}`)
    return { email, password, userId: user.id }
  } finally {
    await api.dispose()
  }
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export interface SignInMail {
  message: MailpitMessage
  code: string
  link: string
}

/** The newest `count` sign-in (link + code) mails to `email`, newest first. */
export async function signInMails(email: string, count = 1): Promise<SignInMail[]> {
  const summaries = await pollFor(
    `${count} sign-in mail(s) to ${email}`,
    async () => {
      const found = (await mailTo(email)).filter((m) => /^\d{6} is your code for /.test(m.Subject))
      return found.length >= count ? found : null
    },
    { timeoutMs: 15_000, intervalMs: 250 }
  )
  const out: SignInMail[] = []
  for (const s of summaries) {
    const message = await getMail(s.ID)
    const link = linksIn(message).find((l) => l.includes('/verify-magic-link?token='))
    if (!link) throw new Error(`no sign-in link in mail ${s.ID}`)
    out.push({ message, code: s.Subject.slice(0, 6), link })
  }
  return out
}

export async function signInMail(email: string): Promise<SignInMail> {
  return (await signInMails(email, 1))[0]
}

/** Mail subjects to `email`, newest first. */
export async function subjectsTo(email: string): Promise<string[]> {
  return (await mailTo(email)).map((m) => m.Subject)
}

/** The token in a sign-in link. */
export function tokenOf(link: string): string {
  const token = new URL(link).searchParams.get('token')
  if (!token) throw new Error(`no token in ${link}`)
  return token
}

/** Ask for a reset mail and return its link (to /api/auth/reset-password/<token>). */
export async function resetLink(api: APIRequestContext, email: string): Promise<string> {
  const res = await api.post('/api/auth/request-password-reset', {
    data: { email, redirectTo: '/auth/reset-password' },
  })
  expect(res.status(), await res.text()).toBe(200)
  const summary = await pollFor(
    `reset mail to ${email}`,
    async () => (await mailTo(email)).find((m) => m.Subject.startsWith('Reset your')) ?? null,
    { timeoutMs: 15_000, intervalMs: 250 }
  )
  const link = linksIn(await getMail(summary.ID)).find((l) => l.includes('/reset-password/'))
  if (!link) throw new Error(`no reset link in mail to ${email}`)
  return link
}

/** Give an account (for example a minted teammate) a password through the reset flow. */
export async function setPasswordByReset(
  playwright: PlaywrightWorkerArgs['playwright'],
  email: string,
  password = PASSWORD
): Promise<void> {
  const api = await anonApi(playwright)
  try {
    const link = await resetLink(api, email)
    const token = new URL(link).pathname.split('/').pop()
    const res = await api.post('/api/auth/reset-password', {
      data: { newPassword: password, token },
    })
    expect(res.status(), await res.text()).toBe(200)
  } finally {
    await api.dispose()
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export async function userRow(
  email: string
): Promise<{ id: string; email_verified: boolean; name: string; country: string | null } | null> {
  const [row] = await supportDb()<
    { id: string; email_verified: boolean; name: string; country: string | null }[]
  >`SELECT id, email_verified, name, country FROM "user" WHERE lower(email) = lower(${email})`
  return row ?? null
}

export async function principalOf(
  userUuid: string
): Promise<{ id: string; role: string; type: string } | null> {
  const [row] = await supportDb()<{ id: string; role: string; type: string }[]>`
    SELECT id, role, type FROM principal WHERE user_id = ${userUuid}`
  return row ?? null
}

export async function sessionsOf(
  userUuid: string
): Promise<{ id: string; token: string; scope: string; expires_at: Date }[]> {
  return supportDb()<{ id: string; token: string; scope: string; expires_at: Date }[]>`
    SELECT id, token, scope, expires_at FROM session WHERE user_id = ${userUuid}
    ORDER BY created_at`
}

export interface AuditRow {
  event_type: string
  event_outcome: string
  actor_email: string | null
  actor_role: string | null
  actor_ip: string | null
  auth_method: string | null
  target_type: string | null
  target_id: string | null
  before_value: Record<string, unknown> | null
  after_value: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

/** Audit rows of one type, newest first, narrowed by actor email or target id. */
export async function audits(
  eventType: string,
  where: { email?: string; targetId?: string; since?: Date } = {}
): Promise<AuditRow[]> {
  const rows = await supportDb()<AuditRow[]>`
    SELECT event_type, event_outcome, actor_email, actor_role, actor_ip, auth_method,
           target_type, target_id, before_value, after_value, metadata
    FROM audit_log
    WHERE event_type = ${eventType}
      AND occurred_at >= ${where.since ?? new Date(0)}
    ORDER BY occurred_at DESC`
  return rows.filter(
    (r) =>
      (!where.email || r.actor_email?.toLowerCase() === where.email.toLowerCase()) &&
      (!where.targetId || r.target_id === where.targetId)
  )
}

export async function waitForAudit(
  eventType: string,
  where: { email?: string; targetId?: string; since?: Date } = {}
): Promise<AuditRow> {
  return pollFor(`audit ${eventType} ${JSON.stringify(where)}`, async () => {
    return (await audits(eventType, where))[0] ?? null
  })
}

export async function verificationRow(identifier: string): Promise<{ value: string } | null> {
  const [row] = await supportDb()<{ value: string }[]>`
    SELECT value FROM verification WHERE identifier = ${identifier}`
  return row ?? null
}

// ---------------------------------------------------------------------------
// Workspace-wide sign-in settings (@isolated only)
// ---------------------------------------------------------------------------

type AuthColumn = 'auth_config' | 'portal_config' | 'tier_limits'

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let node = target
  for (const key of keys.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  if (value === undefined) delete node[keys[keys.length - 1]]
  else node[keys[keys.length - 1]] = value
}

/**
 * Flip sign-in settings (dotted paths per column) for `body`, then write the
 * columns back exactly as they were. Bumps auth_config_version both ways so
 * every cached auth instance rebuilds. Only in the isolated job.
 */
export async function withAuthSettings<T>(
  patch: Partial<Record<AuthColumn, Record<string, unknown>>>,
  body: () => Promise<T>
): Promise<T> {
  if (!ISOLATED) throw new Error('withAuthSettings outside the isolated job')
  const sql = supportDb()
  const columns = Object.keys(patch) as AuthColumn[]
  const [row] = await sql`SELECT ${sql(columns)} FROM settings LIMIT 1`
  const snapshot = Object.fromEntries(columns.map((c) => [c, (row[c] as string | null) ?? null]))
  const next: Record<string, string> = {}
  for (const c of columns) {
    let json: Record<string, unknown> = {}
    try {
      json = (snapshot[c] ? JSON.parse(snapshot[c]) : {}) as Record<string, unknown>
    } catch {
      json = {}
    }
    for (const [path, value] of Object.entries(patch[c] ?? {})) setPath(json, path, value)
    next[c] = JSON.stringify(json)
  }
  const write = async (values: Record<string, string | null>) => {
    await sql`UPDATE settings SET ${sql(values)}, auth_config_version = auth_config_version + 1`
    await bustSettingsCache()
  }
  await write(next)
  try {
    return await body()
  } finally {
    await write(snapshot)
  }
}

// ---------------------------------------------------------------------------
// Identity providers (OIDC single sign-on), with no identity provider behind them
// ---------------------------------------------------------------------------

export interface TestProvider {
  /** TypeID idp_... */
  id: string
  uuid: string
  registrationId: string
  /** The provider's verified domain (unique to the test). */
  domain: string
  /** TypeID domain_... */
  domainId: string
  domainUuid: string
}

/** A domain name only this test uses. */
export function testDomain(marker: string): string {
  return `${marker.replace(/[^a-z0-9]+/g, '-').slice(-40)}.e2e-sso.com`.replace(/^-+/, '')
}

/**
 * A routed-only provider (no public button, no auto-create). Its row is seeded
 * directly, because the editor's save resolves every endpoint in DNS and no
 * identity provider exists here; the client secret goes through the admin's
 * own server function (it is stored encrypted). A verified domain is seeded
 * too (DNS proof is not in the suite), with "Require SSO" on it when
 * `enforced`, and a fresh passed test unless `tested: false`. Nothing answers
 * the endpoints, so journeys needing a provider round trip are not covered.
 * Delete it with `removeProvider` when the test ends.
 */
export async function createProvider(
  adminApi: APIRequestContext,
  marker: string,
  opts: { enforced?: boolean; enabled?: boolean; secret?: boolean; tested?: boolean } = {}
): Promise<TestProvider> {
  const { callServerFn } = await import('../support/server-fns')
  const { generateId, toUuid } = await import('@quackback/ids')
  const sql = supportDb()
  const registrationId = `oidc_${marker.replace(/[^a-z0-9]/g, '').slice(-24)}`
  const id = generateId('idp')
  const uuid = toUuid(id)
  await sql`INSERT INTO identity_provider
              (id, registration_id, label, authorization_url, token_url, user_info_url, client_id,
               scopes, enabled, auto_create_users, show_button, details_changed_at)
            VALUES (${uuid}, ${registrationId}, ${`IdP ${marker}`.slice(0, 120)},
                    'https://idp.e2e-sso.com/authorize', 'https://idp.e2e-sso.com/token',
                    'https://idp.e2e-sso.com/userinfo', ${`client-${marker}`},
                    'openid email profile', ${opts.enabled !== false}, false, false, now())`
  if (opts.secret !== false) {
    const res = await callServerFn(adminApi, 'setProviderCredentialsFn', {
      id,
      clientSecret: `secret-${marker}`,
    })
    if (!res.ok) throw new Error(`provider secret: ${res.error.slice(0, 400)}`)
  }
  const row = { id: uuid }
  if (opts.tested !== false) {
    await sql`UPDATE identity_provider SET last_successful_test_at = now() + interval '1 second'
              WHERE id = ${row.id}`
  }
  const domain = testDomain(marker)
  const domainTypeId = generateId('domain')
  const domainUuid = toUuid(domainTypeId)
  await sql`INSERT INTO sso_verified_domain (id, name, verification_token, verified_at, enforced, provider_id)
            VALUES (${domainUuid}, ${domain}, ${`token-${marker}`}, now(), ${opts.enforced ?? false}, ${row.id})`
  await sql`UPDATE settings SET auth_config_version = auth_config_version + 1`
  await bustSettingsCache()
  return { id, uuid: row.id, registrationId, domain, domainId: domainTypeId, domainUuid }
}

/** Remove a provider made by `createProvider` (its domains go with it). */
export async function removeProvider(provider: TestProvider | null | undefined): Promise<void> {
  if (!provider) return
  const sql = supportDb()
  await sql`DELETE FROM identity_provider WHERE id = ${provider.uuid}`
  await sql`DELETE FROM integration_platform_credentials
            WHERE integration_type = ${`auth_${provider.registrationId}`}`
  await sql`UPDATE settings SET auth_config_version = auth_config_version + 1`
  await bustSettingsCache()
}

/** The settings patch that turns the magic-link (email link and code) method on. */
export const MAGIC_LINK_ON = { auth_config: { 'oauth.magicLink': true } }
