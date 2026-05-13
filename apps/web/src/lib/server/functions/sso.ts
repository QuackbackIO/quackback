/**
 * Admin-only server functions for SSO/OIDC management.
 *
 *  - `testSsoConnectionFn` — fetches an OIDC discovery document and
 *    validates its shape. Reuses `lib/server/content/ssrf-guard.ts`
 *    (private-IP / IPv4-mapped IPv6 / CGNAT blocking, HTTPS-only).
 *
 *  - Verified-domain CRUD (`addVerifiedDomainFn`, `removeVerifiedDomainFn`,
 *    `verifyDomainFn`, `setVerifiedDomainEnforcedFn`, `getVerifiedDomainsFn`)
 *    — manage the per-workspace list of verified domains. Each row carries
 *    its own `enforced` flag: when on, emails at that domain are hard-bound
 *    to SSO (password / magic-link / non-SSO OAuth blocked). Enabling
 *    enforcement requires a recent SSO sign-in by the caller AND configured
 *    email delivery (break-glass precondition).
 *
 *  - `setSsoClientSecretFn` / `clearSsoClientSecretFn` — write the
 *    customer's IdP-issued client secret to `platform_credentials`
 *    (encrypted, cross-pod-invalidated). The customer's IdP issues the
 *    secret to them, so the UI is the only legitimate write channel.
 *
 *  - `getSsoStatusFn` — returns the SSO health row for the settings UI:
 *    last team SSO sign-in, secret presence, discovery reachability
 *    (60s-cached so settings page loads don't hammer the IdP).
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { ConflictError, ForbiddenError } from '@/lib/shared/errors'
import { httpsUrl } from '@/lib/shared/schemas/auth'
import { SSO_OAUTH_CALLBACK_PATH } from '@/lib/shared/sso-test-keys'
import { actorFromAuth, withAuditEvent } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'

const testSsoConnectionInput = z.object({
  discoveryUrl: httpsUrl,
})

/**
 * Stream-cap a Response body at `maxBytes`. Used by the test-connection
 * probe so a malicious IdP returning a multi-MB body can't OOM us by
 * having us call `await res.text()` on the whole thing before slicing.
 *
 * Aborts the underlying reader once the cap is hit. Decoding is
 * UTF-8 with `fatal:false` so a malformed multibyte at the boundary
 * doesn't throw — we trim whatever decoded successfully.
 */
async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - total
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining))
        total = maxBytes
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf)
}

export type TestSsoConnectionResult = { ok: true; issuer: string } | { ok: false; error: string }

/**
 * Probe an OIDC discovery URL. Pure read — does not persist anything.
 * Returns a structured result so the UI can render a friendly status.
 */
export const testSsoConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator(testSsoConnectionInput)
  .handler(async ({ data }): Promise<TestSsoConnectionResult> => {
    await requireAuth({ roles: ['admin'] })
    const { discoveryUrl } = data

    // Reuse the hardened SSRF helper. checkUrlSafety enforces HTTPS
    // (via isSafeScheme), resolves DNS, and rejects private/loopback/
    // CGNAT/IPv4-mapped-IPv6 addresses.
    const { checkUrlSafety } = await import('@/lib/server/content/ssrf-guard')
    const safety = await checkUrlSafety(discoveryUrl)
    if (!safety.safe) {
      const code =
        safety.reason === 'scheme-rejected'
          ? 'invalid_url'
          : safety.reason === 'ssrf-rejected'
            ? 'private_address'
            : 'dns_error'
      return { ok: false, error: code }
    }

    let res: Response
    try {
      res = await fetch(discoveryUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      })
    } catch (err) {
      const code = (err as Error).name === 'TimeoutError' ? 'timeout' : 'fetch_error'
      return { ok: false, error: code }
    }
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, error: 'redirected' }
    }
    if (!res.ok) {
      // Surface the IdP's own error text so misconfigurations are
      // self-diagnosable. Microsoft Entra returns JSON with
      // `error_description` (e.g. AADSTS9... "tenant identifier
      // invalid"); Okta uses `errorSummary`; generic OIDC uses
      // `error_description`. Stream-cap at 4KB — a malicious IdP
      // returning a multi-MB body would otherwise OOM us before we
      // reach the slice.
      const errBody = await readBoundedText(res, 4 * 1024)
      let detail = ''
      try {
        const j = JSON.parse(errBody) as Record<string, unknown>
        const desc = j.error_description ?? j.errorSummary ?? j.error ?? j.message
        if (typeof desc === 'string' && desc.length > 0) detail = `: ${desc.slice(0, 200)}`
      } catch {
        const stripped = errBody
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (stripped) detail = `: ${stripped.slice(0, 200)}`
      }
      return { ok: false, error: `http_${res.status}${detail}` }
    }
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) {
      return { ok: false, error: 'wrong_content_type' }
    }
    // Stream-cap at 64KB. Discovery docs are tiny (~3KB typical) —
    // anything larger is a malformed response or a hostile IdP.
    const text = await readBoundedText(res, 64 * 1024)
    if (text.length === 0) {
      return { ok: false, error: 'empty_body' }
    }
    if (text.length >= 64 * 1024) {
      return { ok: false, error: 'too_large' }
    }
    let json: Record<string, unknown>
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: 'invalid_json' }
    }
    const required = ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const
    for (const field of required) {
      const v = json[field]
      if (typeof v !== 'string' || v.length === 0) {
        return { ok: false, error: `missing_field:${field}` }
      }
      try {
        // Accept any URL — the IdP may legitimately use a different
        // origin for endpoints (Okta does this for token URLs).
        new URL(v)
      } catch {
        return { ok: false, error: `invalid_url_field:${field}` }
      }
    }
    // SSRF-check the endpoints Better-Auth's genericOAuth plugin fetches
    // server-side at runtime. authorization_endpoint is a browser
    // redirect — the user's browser issues the request from their
    // network, so a private address there doesn't open up our internal
    // network. token_endpoint and jwks_uri are fetched by our process,
    // so a malicious or misconfigured discovery doc returning private
    // IPs there would be the SSRF vector. The two probes each do a DNS
    // round-trip; run them in parallel.
    const SSRF_CHECKED_ENDPOINTS = ['token_endpoint', 'jwks_uri'] as const
    const safeties = await Promise.all(
      SSRF_CHECKED_ENDPOINTS.map((field) => checkUrlSafety(json[field] as string))
    )
    const unsafeIndex = safeties.findIndex((s) => !s.safe)
    if (unsafeIndex !== -1) {
      return { ok: false, error: `unsafe_endpoint:${SSRF_CHECKED_ENDPOINTS[unsafeIndex]}` }
    }
    return { ok: true, issuer: json.issuer as string }
  })

const SSO_BOOTSTRAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const verifiedDomainId = z.string().regex(/^domain_/) as z.ZodType<`domain_${string}`>
const setVerifiedDomainEnforcedInput = z.object({
  id: verifiedDomainId,
  enforced: z.boolean(),
})

/**
 * Flip the per-domain `enforced` flag. Preconditions on enable:
 *  1. Caller has a recent SSO sign-in (workspace-scoped bootstrap guard
 *     — there's one IdP per workspace, so any recent SSO attests it's
 *     live and reachable, not just for this specific domain).
 *  2. Magic-link delivery is wired (`isEmailConfigured()` — break-glass
 *     for the rest of the workspace).
 * Disable skips both — any admin can turn enforcement off on any row.
 */
export const setVerifiedDomainEnforcedFn = createServerFn({ method: 'POST' })
  .inputValidator(setVerifiedDomainEnforcedInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    const event = data.enforced
      ? 'sso.enforcement.domain.enabled'
      : 'sso.enforcement.domain.disabled'

    const { setVerifiedDomainEnforced, listVerifiedDomains } =
      await import('@/lib/server/domains/settings/settings.service')

    // Snapshot the prior `enforced` value for the audit row. The full
    // list is small (≤ MAX_VERIFIED_DOMAINS) and the values are cached
    // upstream, so a list read is cheaper than a second targeted query.
    const priorRows = await listVerifiedDomains()
    const prior = priorRows.find((row) => row.id === data.id)
    const before = prior ? { enforced: prior.enforced } : null

    return withAuditEvent(
      {
        event,
        actor: actorFromAuth(auth),
        target: { type: 'sso_verified_domain', id: data.id },
        before,
        after: { enforced: data.enforced },
        headers: getRequestHeaders(),
      },
      async () => {
        if (data.enforced) {
          const { db, principal: principalTable, eq } = await import('@/lib/server/db')
          const principalRow = await db.query.principal.findFirst({
            where: eq(principalTable.userId, auth.user.id),
            columns: { lastSsoSignInAt: true },
          })
          const last = principalRow?.lastSsoSignInAt
          if (!last || last.getTime() < Date.now() - SSO_BOOTSTRAP_WINDOW_MS) {
            throw new ForbiddenError(
              'SSO_BOOTSTRAP_GUARD',
              'Sign in via SSO first to enable enforcement.'
            )
          }

          const { isEmailConfigured } = await import('@quackback/email')
          if (!isEmailConfigured()) {
            throw new ConflictError(
              'SSO_NO_BREAKGLASS',
              'Configure email delivery (SMTP/Resend) before requiring SSO. Magic-link is the only fallback when SSO breaks.'
            )
          }
        }

        return setVerifiedDomainEnforced(data.id, data.enforced)
      }
    )
  })

/** Cache of the last discovery probe per URL. 60s TTL is enough to
 *  stop the settings page from hammering the IdP on every render. */
const reachabilityCache = new Map<string, { ok: boolean; ts: number }>()
const REACHABILITY_TTL_MS = 60_000

export type SsoStatus = {
  lastSignInAt: string | null
  secretConfigured: boolean
  discoveryReachable: boolean | null // null = not configured / unknown
  /**
   * Whether the calling admin has signed in via SSO recently enough
   * that `setVerifiedDomainEnforcedFn`'s bootstrap guard would let them
   * flip enforcement on for any verified domain. Computed against the
   * same `SSO_BOOTSTRAP_WINDOW_MS` the server uses.
   */
  bootstrapEligible: boolean
  /**
   * Redirect URI the admin must register in their IdP App. Better-Auth
   * generic-oauth callbacks land at `${BASE_URL}/api/auth/oauth2/callback/sso`;
   * the admin's IdP rejects sign-in (e.g. Azure AADSTS500113) until this
   * exact URI appears in the App's allowed-redirect list.
   */
  redirectUri: string
}

/**
 * Status row consumed by the admin auth settings UI. Cheap to call —
 * settings cache hit + a single per-team aggregation + a per-caller
 * principal lookup for the bootstrap-eligibility flag.
 */
export const getSsoStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SsoStatus> => {
    const auth = await requireAuth({ roles: ['admin'] })

    const { db, principal: principalTable, sql, inArray, eq } = await import('@/lib/server/db')
    const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
    const { hasSsoClientSecret } = await import('@/lib/server/auth/sso-secret')

    // Run independent reads in parallel: tenant settings, max sign-in
    // timestamp across team, calling admin's own lastSsoSignInAt, and
    // secret presence. Both timestamp queries use the typed column ref
    // (not `sql<Date>` raw expressions) so Drizzle returns Date instances
    // via the postgres adapter — no manual coercion needed.
    const [tenant, maxRows, callerRows, secretConfigured] = await Promise.all([
      getTenantSettings(),
      db
        .select({ ts: principalTable.lastSsoSignInAt })
        .from(principalTable)
        .where(inArray(principalTable.role, ['admin', 'member']))
        .orderBy(sql`${principalTable.lastSsoSignInAt} DESC NULLS LAST`)
        .limit(1),
      db
        .select({ ts: principalTable.lastSsoSignInAt })
        .from(principalTable)
        .where(eq(principalTable.userId, auth.user.id))
        .limit(1),
      hasSsoClientSecret(),
    ])

    const ssoConfig = tenant?.authConfig?.ssoOidc
    const lastSignInAt = maxRows[0]?.ts ?? null
    const callerLast = callerRows[0]?.ts ?? null
    const bootstrapEligible =
      !!callerLast && callerLast.getTime() >= Date.now() - SSO_BOOTSTRAP_WINDOW_MS

    let discoveryReachable: boolean | null = null
    if (ssoConfig?.enabled && ssoConfig.discoveryUrl) {
      const cached = reachabilityCache.get(ssoConfig.discoveryUrl)
      if (cached && Date.now() - cached.ts < REACHABILITY_TTL_MS) {
        discoveryReachable = cached.ok
      } else {
        try {
          const { checkUrlSafety } = await import('@/lib/server/content/ssrf-guard')
          const safety = await checkUrlSafety(ssoConfig.discoveryUrl)
          if (!safety.safe) {
            discoveryReachable = false
          } else {
            const res = await fetch(ssoConfig.discoveryUrl, {
              redirect: 'manual',
              signal: AbortSignal.timeout(3000),
              headers: { Accept: 'application/json' },
            })
            discoveryReachable = res.ok
          }
        } catch {
          discoveryReachable = false
        }
        // Bound the cache: one entry per discoveryUrl in practice, but
        // an admin who rotates the URL repeatedly would otherwise leak
        // entries. 16 is plenty for a single tenant's history.
        if (reachabilityCache.size >= 16) {
          const firstKey = reachabilityCache.keys().next().value
          if (firstKey !== undefined) reachabilityCache.delete(firstKey)
        }
        reachabilityCache.set(ssoConfig.discoveryUrl, {
          ok: discoveryReachable ?? false,
          ts: Date.now(),
        })
      }
    }

    const { config } = await import('@/lib/server/config')
    const redirectUri = `${config.baseUrl.replace(/\/$/, '')}${SSO_OAUTH_CALLBACK_PATH}`

    return {
      lastSignInAt: lastSignInAt ? lastSignInAt.toISOString() : null,
      secretConfigured,
      discoveryReachable,
      bootstrapEligible,
      redirectUri,
    }
  }
)

const setSsoClientSecretInput = z.object({
  clientSecret: z.string().min(1).max(2048),
})

/**
 * Persist the SSO OIDC client secret to `platform_credentials`. The
 * underlying writer encrypts via AES-256-GCM with HKDF-derived keys,
 * bumps `auth_config_version` for cross-pod invalidation, and calls
 * `resetAuth()` so the next request rebuilds Better-Auth with the new
 * secret. Admin-only; the secret is customer-owned (issued by their
 * IdP — Azure Entra, Okta, Auth0, Keycloak — to *their* application).
 */
export const setSsoClientSecretFn = createServerFn({ method: 'POST' })
  .inputValidator(setSsoClientSecretInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    return withAuditEvent(
      {
        event: 'sso.config.changed',
        actor: actorFromAuth(auth),
        metadata: { field: 'clientSecret', action: 'set' },
        headers: getRequestHeaders(),
      },
      async () => {
        const { savePlatformCredentials } =
          await import('@/lib/server/domains/platform-credentials/platform-credential.service')
        const { SSO_CREDENTIAL_TYPE } = await import('@/lib/server/auth/sso-secret')
        await savePlatformCredentials({
          integrationType: SSO_CREDENTIAL_TYPE,
          credentials: { clientSecret: data.clientSecret.trim() },
          principalId: auth.principal.id,
        })
        return { success: true }
      }
    )
  })

/**
 * Atomically wipe SSO so the admin can start over with a new IdP.
 * Clears both the encrypted client secret (in `platform_credentials`)
 * AND the `authConfig.ssoOidc` block (discoveryUrl, clientId, etc.)
 * so the settings page returns to its empty-state provider picker.
 * Verified-domain rows are preserved — they apply to whichever provider
 * the admin sets up next.
 *
 * Auto-disables `enforced` on any verified-domain rows that have it
 * on. Enforced-domain users would otherwise be hard-bound to an
 * unregistered IdP and locked out during the gap between providers;
 * the verified rows themselves stay (domain ownership is unchanged),
 * but hard-binding drops to false. Re-enforcing post-setup is one
 * toggle in the Verified domains card. Returns the affected domain
 * names so the UI can surface a toast.
 *
 * Distinct from `clearSsoClientSecretFn` (a rotation primitive that
 * deletes only the secret) — switching providers needs to drop the
 * config block too, else the UI would re-render with the prior IdP's
 * URL / client-id locked in.
 */
export const switchSsoProviderFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ roles: ['admin'] })

  return withAuditEvent(
    {
      event: 'sso.config.changed',
      actor: actorFromAuth(auth),
      metadata: { action: 'switched_provider' },
      headers: getRequestHeaders(),
    },
    async () => {
      const { getTenantSettings, setVerifiedDomainEnforced } =
        await import('@/lib/server/domains/settings/settings.service')
      const tenant = await getTenantSettings()

      const enforcedRows = tenant?.verifiedDomains.filter((d) => d.enforced) ?? []
      for (const row of enforcedRows) {
        await setVerifiedDomainEnforced(row.id, false)
      }

      const { deletePlatformCredentials } =
        await import('@/lib/server/domains/platform-credentials/platform-credential.service')
      const { SSO_CREDENTIAL_TYPE } = await import('@/lib/server/auth/sso-secret')
      await deletePlatformCredentials(SSO_CREDENTIAL_TYPE)

      const { db } = await import('@/lib/server/db')
      const { settings } = await import('@/lib/server/db')
      const { eq } = await import('drizzle-orm')
      const { requireSettings } = await import('@/lib/server/domains/settings/settings.helpers')
      const { parseJsonConfig, invalidateSettingsCache } =
        await import('@/lib/server/domains/settings/settings.helpers')
      const { DEFAULT_AUTH_CONFIG } = await import('@/lib/server/domains/settings/settings.types')
      const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
      const { resetAuth } = await import('@/lib/server/auth')

      const org = await requireSettings()
      const existing = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
      const { ssoOidc: _stripped, ...rest } = existing
      void _stripped
      await db.transaction(async (tx) => {
        await tx
          .update(settings)
          .set({ authConfig: JSON.stringify(rest) })
          .where(eq(settings.id, org.id))
        await bumpAuthConfigVersionInTx(tx)
      })
      resetAuth()
      await invalidateSettingsCache()

      return {
        success: true,
        defangedDomains: enforcedRows.map((r) => r.name),
      }
    }
  )
})

/**
 * Remove the SSO OIDC client secret. Use to rotate (delete + save
 * again) or wind down SSO. The auth runtime will skip SSO registration
 * on the next request because no secret is available.
 */
export const clearSsoClientSecretFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ roles: ['admin'] })

  return withAuditEvent(
    {
      event: 'sso.config.changed',
      actor: actorFromAuth(auth),
      metadata: { field: 'clientSecret', action: 'cleared' },
      headers: getRequestHeaders(),
    },
    async () => {
      // Refuse to clear while any verified domain has enforcement on —
      // clearing the secret skips SSO registration, and enforced-domain
      // emails would have no working sign-in path. Refuse also when any
      // domain is verified at all: those emails are routed to SSO by
      // default; without the secret, the redirect would 4xx. Force the
      // admin to explicitly remove the affected domains first.
      const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
      const tenant = await getTenantSettings()
      const enforcedRow = tenant?.verifiedDomains.find((d) => d.enforced)
      if (enforcedRow) {
        const { ValidationError } = await import('@/lib/shared/errors')
        throw new ValidationError(
          'SSO_ENFORCEMENT_ACTIVE',
          `Disable SSO enforcement on ${enforcedRow.name} before removing the client secret.`
        )
      }
      const verifiedRow = tenant?.verifiedDomains.find((d) => d.verifiedAt !== null)
      if (verifiedRow) {
        const { ValidationError } = await import('@/lib/shared/errors')
        throw new ValidationError(
          'SSO_DOMAIN_VERIFIED',
          `Remove the verified domain ${verifiedRow.name} before removing the client secret.`
        )
      }
      const { deletePlatformCredentials } =
        await import('@/lib/server/domains/platform-credentials/platform-credential.service')
      const { SSO_CREDENTIAL_TYPE } = await import('@/lib/server/auth/sso-secret')
      await deletePlatformCredentials(SSO_CREDENTIAL_TYPE)
      return { success: true }
    }
  )
})

// =============================================================================
// SSO domain verification
// =============================================================================

/**
 * Per-domain Redis rate-limit (SET-NX-EX, 10s window). Throws when
 * throttled. Keyed on tenant+domain so admins can verify multiple
 * pending domains in parallel without throttling each other.
 */
async function assertVerifyDomainRateLimit(tenantId: string, domainId: string): Promise<void> {
  const { getRedis } = await import('@/lib/server/redis')
  const took = await getRedis().set(`verify-domain:${tenantId}:${domainId}`, '1', 'EX', 10, 'NX')
  if (took !== 'OK') {
    throw new ConflictError(
      'VERIFY_RATE_LIMITED',
      'Slow down — wait a few seconds before retrying.'
    )
  }
}

const addVerifiedDomainInput = z.object({
  name: z.string().min(1).max(253),
})

/**
 * Insert a pending verified-domain row. Idempotent on `name`: a repeat
 * call with the same domain returns the existing row (preserving its
 * verification state and token). Normalisation runs through the shared
 * `verifiableDomain` zod transformer so reserved suffixes, IP literals,
 * and IDN labels are rejected before we hit the writer.
 */
export const addVerifiedDomainFn = createServerFn({ method: 'POST' })
  .inputValidator(addVerifiedDomainInput)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const { verifiableDomain } = await import('@/lib/server/auth/normalize-domain')
    const parsed = verifiableDomain.safeParse(data.name)
    if (!parsed.success) {
      const { ValidationError } = await import('@/lib/shared/errors')
      throw new ValidationError(
        'INVALID_DOMAIN',
        parsed.error.issues[0]?.message ?? 'Invalid domain'
      )
    }

    const { insertVerifiedDomain } = await import('@/lib/server/domains/settings/settings.service')
    return insertVerifiedDomain(parsed.data)
  })

const removeVerifiedDomainInput = z.object({ id: verifiedDomainId })

/** Remove a verified-domain row by id. No-op if it doesn't exist. */
export const removeVerifiedDomainFn = createServerFn({ method: 'POST' })
  .inputValidator(removeVerifiedDomainInput)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const { removeVerifiedDomain } = await import('@/lib/server/domains/settings/settings.service')
    await removeVerifiedDomain(data.id)
    return { success: true }
  })

const verifyDomainInput = z.object({ id: verifiedDomainId })

export type VerifyDomainResult =
  | { verified: true; verifiedAt: string }
  | { verified: false; reason: 'no-record' | 'lookup-failed' | 'mismatch' | 'no-pending-domain' }

/**
 * Resolve the DNS TXT record for a pending domain row and stamp
 * `verified_at` on match. Per-domain rate-limited. Never throws on
 * lookup failure — returns a structured `reason` so the UI can render
 * specific guidance.
 */
export const verifyDomainFn = createServerFn({ method: 'POST' })
  .inputValidator(verifyDomainInput)
  .handler(async ({ data }): Promise<VerifyDomainResult> => {
    await requireAuth({ roles: ['admin'] })

    const { getTenantSettings, stampVerifiedDomain } =
      await import('@/lib/server/domains/settings/settings.service')
    const tenant = await getTenantSettings()
    if (!tenant?.settings?.id) {
      return { verified: false, reason: 'no-pending-domain' }
    }
    const dom = tenant.verifiedDomains.find((d) => d.id === data.id)
    if (!dom) {
      return { verified: false, reason: 'no-pending-domain' }
    }
    await assertVerifyDomainRateLimit(tenant.settings.id, dom.id)

    const { lookupVerificationTxt } = await import('@/lib/server/auth/dns-verify')
    const expected = `qb-domain-verify=${dom.verificationToken}`
    const result = await lookupVerificationTxt(`_quackback-verify.${dom.name}`)
    if (!result.ok) {
      return { verified: false, reason: result.reason }
    }
    if (!result.values.includes(expected)) {
      return { verified: false, reason: 'mismatch' }
    }

    const verifiedAt = new Date().toISOString()
    try {
      await stampVerifiedDomain({
        id: dom.id,
        expectedToken: dom.verificationToken,
        verifiedAt,
      })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'STALE_VERIFICATION_TOKEN') {
        return { verified: false, reason: 'lookup-failed' }
      }
      throw err
    }
    return { verified: true, verifiedAt }
  })

/** Read-only listing of the workspace's verified-domain rows. */
export const getVerifiedDomainsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
  const tenant = await getTenantSettings()
  return tenant?.verifiedDomains ?? []
})
