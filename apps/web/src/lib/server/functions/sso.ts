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
import type { IdentityProviderId } from '@quackback/ids'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { httpsUrl } from '@/lib/shared/schemas/auth'
import { SSO_OAUTH_CALLBACK_PATH } from '@/lib/shared/sso-test-keys'
import { actorFromAuth, withAuditEvent } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'

const testSsoConnectionInput = z.object({
  discoveryUrl: httpsUrl,
})

export type TestSsoConnectionResult = { ok: true; issuer: string } | { ok: false; error: string }

/**
 * Probe an OIDC discovery URL. Pure read — does not persist anything.
 * Returns a structured result so the UI can render a friendly status.
 */
export const testSsoConnectionFn = createServerFn({ method: 'POST' })
  .validator(testSsoConnectionInput)
  .handler(async ({ data }): Promise<TestSsoConnectionResult> => {
    await requireAuth({ roles: ['admin'] })
    const { discoveryUrl } = data

    // safeFetch validates the URL, connects to the *resolved IP*
    // (closing the DNS-rebind window a bare checkUrlSafety + fetch
    // leaves open), never follows redirects, and caps the body size.
    const { safeFetch, SsrfError, TimeoutError, checkUrlSafety } =
      await import('@/lib/server/content/ssrf-guard')

    let res: Response
    try {
      res = await safeFetch(discoveryUrl, {
        headers: { Accept: 'application/json' },
        timeoutMs: 5000,
        maxResponseBytes: 64 * 1024,
      })
    } catch (err) {
      if (err instanceof SsrfError) {
        const code =
          err.reason === 'scheme-rejected'
            ? 'invalid_url'
            : err.reason === 'ssrf-rejected'
              ? 'private_address'
              : 'dns_error'
        return { ok: false, error: code }
      }
      const code = err instanceof TimeoutError ? 'timeout' : 'fetch_error'
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
      // `error_description`. safeFetch already capped the body size.
      const errBody = await res.text()
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
    const text = await res.text()
    if (text.length === 0) {
      return { ok: false, error: 'empty_body' }
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

const verifiedDomainId = z.string().regex(/^domain_/) as z.ZodType<`domain_${string}`>
const setVerifiedDomainEnforcedInput = z.object({
  id: verifiedDomainId,
  enforced: z.boolean(),
})

/**
 * Flip the per-domain `enforced` flag. Preconditions on enable:
 *  1. SSO is proven working since the last connection-details change —
 *     either a successful test sign-in or a real team SSO sign-in that
 *     postdates `ssoOidc.detailsChangedAt` (`isSsoEnforcementUnlocked`).
 *     Workspace-scoped: there's one IdP per workspace, so a proof for
 *     any domain attests the IdP is live and reachable.
 *  2. Magic-link delivery is wired (`isEmailConfigured()` — break-glass
 *     for the rest of the workspace).
 * Disable skips both — any admin can turn enforcement off on any row.
 */
export const setVerifiedDomainEnforcedFn = createServerFn({ method: 'POST' })
  .validator(setVerifiedDomainEnforcedInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    const event = data.enforced
      ? 'sso.enforcement.domain.enabled'
      : 'sso.enforcement.domain.disabled'

    const { setVerifiedDomainEnforced, getTenantSettings } =
      await import('@/lib/server/domains/settings/settings.service')
    const { db, principal: principalTable, sql, inArray } = await import('@/lib/server/db')

    // One cached `getTenantSettings()` covers both the prior `enforced`
    // snapshot (for the audit row) and the `ssoOidc` config (for the
    // enforce gate). When enabling, the max-team-SSO-sign-in query —
    // the alternative gate proof to a test sign-in — runs in parallel.
    const [tenant, maxRow] = await Promise.all([
      getTenantSettings(),
      data.enforced
        ? db
            .select({ ts: principalTable.lastSsoSignInAt })
            .from(principalTable)
            .where(inArray(principalTable.role, ['admin', 'member']))
            .orderBy(sql`${principalTable.lastSsoSignInAt} DESC NULLS LAST`)
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ])
    const prior = tenant?.verifiedDomains.find((row) => row.id === data.id)
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
          const { isSsoEnforcementUnlocked } = await import('@/lib/server/auth/sso-gates')
          if (!isSsoEnforcementUnlocked(tenant?.authConfig?.ssoOidc, maxRow?.ts ?? null)) {
            throw new ForbiddenError(
              'SSO_TEST_REQUIRED',
              'Run a successful test sign-in before enabling enforcement.'
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
   * Whether **enabling SSO** is unlocked: a successful test sign-in
   * postdates the last connection-details change
   * (`isSsoTestValid`). When false the Enable toggle still renders but
   * routes through the test-sign-in prompt modal first.
   */
  enableEligible: boolean
  /**
   * Whether **per-domain enforcement** is unlocked: a test sign-in OR a
   * real team SSO sign-in postdates the last details change
   * (`isSsoEnforcementUnlocked`). Same prompt-modal treatment when false.
   */
  enforcementEligible: boolean
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
 * settings cache hit + a single per-team max-sign-in aggregation. The
 * enable / enforcement eligibility flags are derived from the settings
 * blob (`ssoOidc` timestamps) plus that aggregation, no extra reads.
 */
export const getSsoStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SsoStatus> => {
    await requireAuth({ roles: ['admin'] })

    const { db, principal: principalTable, sql, inArray } = await import('@/lib/server/db')
    const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
    const { hasSsoClientSecret } = await import('@/lib/server/auth/sso-secret')

    // Run independent reads in parallel: tenant settings, max sign-in
    // timestamp across team, and secret presence. The timestamp query
    // uses the typed column ref (not a `sql<Date>` raw expression) so
    // Drizzle returns a Date instance via the postgres adapter.
    const [tenant, maxRows, secretConfigured] = await Promise.all([
      getTenantSettings(),
      db
        .select({ ts: principalTable.lastSsoSignInAt })
        .from(principalTable)
        .where(inArray(principalTable.role, ['admin', 'member']))
        .orderBy(sql`${principalTable.lastSsoSignInAt} DESC NULLS LAST`)
        .limit(1),
      hasSsoClientSecret(),
    ])

    const ssoConfig = tenant?.authConfig?.ssoOidc
    const lastSignInAt = maxRows[0]?.ts ?? null

    // Gate eligibility: enabling SSO needs a valid test sign-in;
    // enforcement also accepts a real team SSO sign-in. Both compare
    // against `ssoOidc.detailsChangedAt` so a stale proof doesn't count.
    const { isSsoTestValid, isSsoEnforcementUnlocked } = await import('@/lib/server/auth/sso-gates')
    const enableEligible = isSsoTestValid(ssoConfig)
    const enforcementEligible = isSsoEnforcementUnlocked(ssoConfig, lastSignInAt)

    let discoveryReachable: boolean | null = null
    if (ssoConfig?.enabled && ssoConfig.discoveryUrl) {
      const cached = reachabilityCache.get(ssoConfig.discoveryUrl)
      if (cached && Date.now() - cached.ts < REACHABILITY_TTL_MS) {
        discoveryReachable = cached.ok
      } else {
        try {
          const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
          const res = await safeFetch(ssoConfig.discoveryUrl, {
            headers: { Accept: 'application/json' },
            timeoutMs: 3000,
          })
          discoveryReachable = res.ok
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
      enableEligible,
      enforcementEligible,
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
  .validator(setSsoClientSecretInput)
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
        // The client secret is a connection-affecting field — stamp
        // detailsChangedAt so any prior test sign-in stops counting
        // until the admin re-tests against the new secret.
        const { markSsoDetailsChanged } =
          await import('@/lib/server/domains/settings/settings.service')
        await markSsoDetailsChanged()
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
  .validator(addVerifiedDomainInput)
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
  .validator(removeVerifiedDomainInput)
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
  .validator(verifyDomainInput)
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

// =============================================================================
// Identity-provider CRUD (multi-provider, Task 15)
//
// Admin-gated wrappers over `identity-providers.service` — the data logic
// (version bump + resetAuth + cache invalidation, credential cleanup) lives
// in the service; these add the auth gate, the audit row, and provider-scoped
// verified-domain handling on top.
// =============================================================================

/** TypeID validator for an identity-provider row id. */
const identityProviderId = z.string().regex(/^idp_/) as z.ZodType<IdentityProviderId>

const idpRole = z.enum(['admin', 'member', 'user'])

/** Claim-to-role mapping mirror of `IdentityProviderAttributeMapping`. */
const attributeMappingSchema = z.object({
  claimPath: z.string(),
  rules: z.array(z.object({ whenContains: z.string(), role: idpRole })),
  defaultRole: idpRole,
  syncOnEverySignIn: z.boolean().optional(),
})

const upsertIdentityProviderInput = z.object({
  // Present when editing; absent on create (matched by registrationId).
  id: identityProviderId.optional(),
  registrationId: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  clientId: z.string().min(1).max(512),
  discoveryUrl: httpsUrl.nullable().optional(),
  authorizationUrl: httpsUrl.nullable().optional(),
  tokenUrl: httpsUrl.nullable().optional(),
  userInfoUrl: httpsUrl.nullable().optional(),
  scopes: z.string().max(512).nullable().optional(),
  enabled: z.boolean().optional(),
  autoCreateUsers: z.boolean().optional(),
  autoProvisionRole: idpRole.nullable().optional(),
  attributeMapping: attributeMappingSchema.nullable().optional(),
  showButton: z.boolean().optional(),
})

/** Read-only listing of every identity provider with its linked domains. */
export const listIdentityProvidersFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  const { listIdentityProviders } =
    await import('@/lib/server/domains/settings/identity-providers.service')
  return listIdentityProviders()
})

/**
 * Create or update a provider (matched by `id`, else by `registrationId`).
 * Emits `idp.created` / `idp.updated` based on whether a matching row
 * already exists; the underlying service bumps the auth-config version and
 * resets the local auth instance so the new config registers.
 */
export const upsertIdentityProviderFn = createServerFn({ method: 'POST' })
  .validator(upsertIdentityProviderInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    const { listIdentityProviders, upsertIdentityProvider } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const existing = await listIdentityProviders()
    const prior = data.id
      ? existing.find((p) => p.id === data.id)
      : existing.find((p) => p.registrationId === data.registrationId)

    return withAuditEvent(
      {
        event: prior ? 'idp.updated' : 'idp.created',
        actor: actorFromAuth(auth),
        target: { type: 'identity_provider', id: prior?.id ?? data.registrationId },
        before: prior ? { label: prior.label, enabled: prior.enabled } : null,
        after: {
          registrationId: data.registrationId,
          label: data.label,
          enabled: data.enabled ?? false,
        },
        headers: getRequestHeaders(),
      },
      async () => upsertIdentityProvider(data)
    )
  })

const deleteIdentityProviderInput = z.object({ id: identityProviderId })

/**
 * Delete a provider by id. The service cascades its linked domains via the
 * FK and removes the `auth_<registrationId>` credential explicitly (no FK
 * to cascade), then resets auth.
 */
export const deleteIdentityProviderFn = createServerFn({ method: 'POST' })
  .validator(deleteIdentityProviderInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    return withAuditEvent(
      {
        event: 'idp.deleted',
        actor: actorFromAuth(auth),
        target: { type: 'identity_provider', id: data.id },
        headers: getRequestHeaders(),
      },
      async () => {
        const { deleteIdentityProvider } =
          await import('@/lib/server/domains/settings/identity-providers.service')
        await deleteIdentityProvider(data.id)
        return { success: true }
      }
    )
  })

const setProviderCredentialsInput = z.object({
  id: identityProviderId,
  clientSecret: z.string().min(1).max(2048),
})

/**
 * Persist a provider's IdP-issued client secret to `platform_credentials`
 * at key `auth_<registrationId>` (the auth runtime reads the secret from
 * there; clientId / discoveryUrl come from the provider row). The secret is
 * a connection-affecting field, so stamp `detailsChangedAt` on the provider
 * to invalidate any prior test sign-in until the admin re-tests.
 */
export const setProviderCredentialsFn = createServerFn({ method: 'POST' })
  .validator(setProviderCredentialsInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    const { listIdentityProviders, stampDetailsChanged } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const provider = (await listIdentityProviders()).find((p) => p.id === data.id)
    if (!provider) {
      throw new ValidationError('IDP_NOT_FOUND', 'Identity provider not found.')
    }

    return withAuditEvent(
      {
        event: 'idp.credentials.changed',
        actor: actorFromAuth(auth),
        target: { type: 'identity_provider', id: provider.id },
        metadata: { field: 'clientSecret', action: 'set' },
        headers: getRequestHeaders(),
      },
      async () => {
        const { savePlatformCredentials } =
          await import('@/lib/server/domains/platform-credentials/platform-credential.service')
        const { AUTH_CREDENTIAL_PREFIX } = await import('@/lib/server/auth/auth-providers')
        await savePlatformCredentials({
          integrationType: `${AUTH_CREDENTIAL_PREFIX}${provider.registrationId}`,
          credentials: { clientSecret: data.clientSecret.trim() },
          principalId: auth.principal.id,
        })
        await stampDetailsChanged(provider.id)
        return { success: true }
      }
    )
  })

const addProviderDomainInput = z.object({
  providerId: identityProviderId,
  name: z.string().min(1).max(253),
})

/**
 * Insert a pending verified-domain row linked to `providerId`. Idempotent
 * on `name` (globally unique); a previously-unlinked domain is adopted by
 * the provider. Normalisation runs through the shared `verifiableDomain`
 * transformer (reserved suffixes, IP literals, IDN labels rejected).
 */
export const addProviderDomainFn = createServerFn({ method: 'POST' })
  .validator(addProviderDomainInput)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const { verifiableDomain } = await import('@/lib/server/auth/normalize-domain')
    const parsed = verifiableDomain.safeParse(data.name)
    if (!parsed.success) {
      throw new ValidationError(
        'INVALID_DOMAIN',
        parsed.error.issues[0]?.message ?? 'Invalid domain'
      )
    }

    const { insertVerifiedDomain } = await import('@/lib/server/domains/settings/settings.service')
    return insertVerifiedDomain(parsed.data, data.providerId)
  })

const verifyProviderDomainInput = z.object({
  providerId: identityProviderId,
  id: verifiedDomainId,
})

/**
 * Resolve the DNS TXT record for a provider's pending domain and stamp
 * `verified_at` on match. Provider-scoped: the domain must belong to
 * `providerId`. Per-domain rate-limited; never throws on lookup failure —
 * returns a structured `reason`.
 */
export const verifyProviderDomainFn = createServerFn({ method: 'POST' })
  .validator(verifyProviderDomainInput)
  .handler(async ({ data }): Promise<VerifyDomainResult> => {
    await requireAuth({ roles: ['admin'] })

    const { getTenantSettings, stampVerifiedDomain } =
      await import('@/lib/server/domains/settings/settings.service')
    const tenant = await getTenantSettings()
    if (!tenant?.settings?.id) {
      return { verified: false, reason: 'no-pending-domain' }
    }
    const dom = tenant.verifiedDomains.find(
      (d) => d.id === data.id && d.providerId === data.providerId
    )
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

const setDomainEnforcedInput = z.object({
  id: verifiedDomainId,
  enforced: z.boolean(),
})

/**
 * Flip a provider-scoped domain's `enforced` flag. Enabling preconditions
 * key off the OWNING provider's freshness (`detailsChangedAt` /
 * `lastSuccessfulTestAt`):
 *  1. A successful TEST through this provider since its last details change —
 *     `isSsoEnforcementUnlocked(provider, null)`. We pass `null` (no team-wide
 *     sign-in fallback) deliberately: `principal.lastSsoSignInAt` is
 *     provider-independent, so accepting it would let a sign-in via provider B
 *     unlock never-validated provider A.
 *  2. Magic-link delivery configured (break-glass for the rest of the team).
 * Disabling skips both.
 */
export const setDomainEnforcedFn = createServerFn({ method: 'POST' })
  .validator(setDomainEnforcedInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    const { listIdentityProviders } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const { setVerifiedDomainEnforced } =
      await import('@/lib/server/domains/settings/settings.service')

    // Load providers for the owning provider's freshness gate + the audit
    // before-snapshot.
    const providers = await listIdentityProviders()

    let owningProvider: (typeof providers)[number] | undefined
    let dom: (typeof providers)[number]['domains'][number] | undefined
    for (const p of providers) {
      const match = p.domains.find((d) => d.id === data.id)
      if (match) {
        owningProvider = p
        dom = match
        break
      }
    }

    return withAuditEvent(
      {
        event: data.enforced ? 'idp.domain.enforced' : 'idp.domain.unenforced',
        actor: actorFromAuth(auth),
        target: { type: 'sso_verified_domain', id: data.id },
        before: dom ? { enforced: dom.enforced } : null,
        after: { enforced: data.enforced },
        metadata: owningProvider ? { providerId: owningProvider.id } : undefined,
        headers: getRequestHeaders(),
      },
      async () => {
        if (data.enforced) {
          if (!owningProvider) {
            throw new ValidationError(
              'VERIFIED_DOMAIN_NOT_FOUND',
              'Domain is not linked to an identity provider.'
            )
          }
          const { isSsoEnforcementUnlocked } = await import('@/lib/server/auth/sso-gates')
          // Pass null (no team-wide sign-in fallback): enforcement requires a
          // successful TEST through THIS provider. `principal.lastSsoSignInAt`
          // is provider-independent, so accepting it would let a sign-in via
          // provider B unlock never-validated provider A.
          if (!isSsoEnforcementUnlocked(owningProvider, null)) {
            throw new ForbiddenError(
              'SSO_TEST_REQUIRED',
              'Run a successful test sign-in before enabling enforcement.'
            )
          }

          const { isEmailConfigured } = await import('@quackback/email')
          if (!isEmailConfigured()) {
            throw new ConflictError(
              'SSO_NO_BREAKGLASS',
              'Configure email delivery (SMTP/Resend) before requiring SSO. Magic-link is the only fallback when SSO breaks.'
            )
          }

          const { hasActiveRecoveryCodes } = await import(
            '@/lib/server/auth/recovery-codes-status'
          )
          if (!(await hasActiveRecoveryCodes())) {
            throw new Error('recovery_codes_required')
          }
        }

        return setVerifiedDomainEnforced(data.id, data.enforced)
      }
    )
  })
