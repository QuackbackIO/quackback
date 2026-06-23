/**
 * Admin-only server functions for SSO/OIDC management.
 *
 *  - `clearSsoClientSecretFn` — removes the customer's IdP-issued client
 *    secret from `platform_credentials` (encrypted, cross-pod-invalidated).
 *    Used to rotate the secret or wind SSO down.
 *
 *  - Verified-domain reads/removal (`getVerifiedDomainsFn`,
 *    `removeVerifiedDomainFn`) — manage the per-workspace list of verified
 *    domains. Each row carries its own `enforced` flag: when on, emails at
 *    that domain are hard-bound to SSO (password / magic-link / non-SSO
 *    OAuth blocked).
 *
 *  - Identity-provider CRUD (`listIdentityProvidersFn`,
 *    `upsertIdentityProviderFn`, `deleteIdentityProviderFn`,
 *    `setProviderCredentialsFn`, `addProviderDomainFn`,
 *    `verifyProviderDomainFn`, `setDomainEnforcedFn`) — the multi-provider
 *    model: admin-gated wrappers over `identity-providers.service` that add
 *    the auth gate, the audit row, and provider-scoped domain handling.
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { IdentityProviderId } from '@quackback/ids'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { httpsUrl } from '@/lib/shared/schemas/auth'
import { actorFromAuth, withAuditEvent } from '@/lib/server/audit/log'
import { providerPathKey } from '@/lib/server/config-file/managed-paths'
import { requireAuth } from './auth-helpers'

const verifiedDomainId = z.string().regex(/^domain_/) as z.ZodType<`domain_${string}`>

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
      // Clearing the secret unconfigures the 'sso' provider; refuse if it's the
      // workspace's only working sign-in method (a no-public-button 'sso' isn't
      // caught by the verified-domain checks above).
      const { listIdentityProviders } =
        await import('@/lib/server/domains/settings/identity-providers.service')
      const ssoProvider = (await listIdentityProviders()).find((p) => p.registrationId === 'sso')
      if (ssoProvider) {
        const { checkIsOnlyWorkingSignInMethod } =
          await import('@/lib/server/auth/sign-in-method-availability')
        if (await checkIsOnlyWorkingSignInMethod(ssoProvider.id)) {
          throw new ConflictError(
            'LAST_SIGN_IN_METHOD',
            'Cannot remove the only enabled sign-in method. Enable another method first.'
          )
        }
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

export type VerifyDomainResult =
  | { verified: true; verifiedAt: string }
  | { verified: false; reason: 'no-record' | 'lookup-failed' | 'mismatch' | 'no-pending-domain' }

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
  // IdP family from the setup shortcut — purely drives which editor controls
  // and label render; does not affect Better-Auth registration.
  kind: z.enum(['okta', 'auth0', 'keycloak', 'entra', 'google', 'other']).nullable().optional(),
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

    // Refuse to disable the workspace's only working sign-in method (lockout).
    // Only a true→false transition on a currently-usable provider can do it.
    if (data.enabled === false && prior?.enabled && prior.configured) {
      const { checkIsOnlyWorkingSignInMethod } =
        await import('@/lib/server/auth/sign-in-method-availability')
      if (await checkIsOnlyWorkingSignInMethod(prior.id, existing)) {
        throw new ConflictError(
          'LAST_SIGN_IN_METHOD',
          'Cannot disable the only enabled sign-in method. Enable another method first.'
        )
      }
    }

    // Managed-path guard: refuse in-app edits of config-file-declared providers.
    // NOTE: The guard keys on the prior (existing) label. A rename changes the
    // providerPathKey, so renaming a managed provider can escape this lock. That
    // is a known design limitation; the fix requires a stable config-file
    // provider id rather than a label-derived key.
    {
      const { assertNotManaged } = await import('@/lib/server/config-file/managed-guard')
      const base = `auth.identityProviders.${providerPathKey(prior?.label ?? data.label)}`
      await assertNotManaged(`${base}.discoveryUrl`)
      await assertNotManaged(`${base}.clientId`)
      if (data.enabled !== undefined) await assertNotManaged(`${base}.enabled`)
      if (data.autoCreateUsers !== undefined) await assertNotManaged(`${base}.autoCreateUsers`)
      if (data.autoProvisionRole !== undefined) await assertNotManaged(`${base}.autoProvisionRole`)
      if (data.scopes !== undefined) await assertNotManaged(`${base}.scopes`)
    }

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

    // Refuse to remove the workspace's only working sign-in method — doing so
    // would lock everyone out. Mirrors the UI's disabled Remove button.
    const { checkIsOnlyWorkingSignInMethod } =
      await import('@/lib/server/auth/sign-in-method-availability')
    if (await checkIsOnlyWorkingSignInMethod(data.id)) {
      throw new ConflictError(
        'LAST_SIGN_IN_METHOD',
        'Cannot remove the only enabled sign-in method. Enable another method first.'
      )
    }

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
  // Trim BEFORE min(1) so a whitespace-only secret is rejected, not saved as an
  // empty credential that still reads as `configured`.
  clientSecret: z.string().trim().min(1).max(2048),
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

          const { hasActiveRecoveryCodes } = await import('@/lib/server/auth/recovery-codes-status')
          if (!(await hasActiveRecoveryCodes())) {
            throw new ForbiddenError('RECOVERY_CODES_REQUIRED', 'recovery_codes_required')
          }
        }

        return setVerifiedDomainEnforced(data.id, data.enforced)
      }
    )
  })
