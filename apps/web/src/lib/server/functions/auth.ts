/**
 * Public-surface server function for the email-first login dispatcher.
 *
 * `lookupAuthMethodsFn` is shared by both `/admin/login` (team) and
 * `/auth/login` (portal). Given an email and a surface, it tells the
 * client whether to redirect to the configured SSO IdP (verified-
 * domain match — same hard-binding rule on both surfaces) or render
 * the methods form for that surface.
 *
 * Deliberately does NOT look up whether an account exists at the
 * supplied email — that would leak account presence to anyone who can
 * POST to this endpoint. Branching is purely on email-domain match
 * against the tenant's verified domain.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const lookupAuthMethodsInput = z.object({
  email: z.string().email().max(320),
  surface: z.enum(['team', 'portal']).default('team'),
})

export type LookupAuthMethodsResult =
  /** Verified-domain email AND enforcement is on — must use the owning
   *  provider, no escape. `providerId` is that provider's registrationId
   *  (Task 14 threads it to the client's `signIn.oauth2({ providerId })`). */
  | { kind: 'sso-redirect'; providerId: string }
  /** Verified-domain email AND enforcement is off — the owning provider is
   *  the default CTA, but the methods form is available as a fallback so
   *  users can pick password / magic-link / OAuth if they prefer.
   *  `providerId` is the owning provider's registrationId. */
  | {
      kind: 'sso-default'
      providerId: string
      authConfig: Record<string, boolean | undefined>
    }
  | {
      kind: 'methods'
      authConfig: Record<string, boolean | undefined>
      ssoEnabled: boolean
    }

export const lookupAuthMethodsFn = createServerFn({ method: 'POST' })
  .validator(lookupAuthMethodsInput)
  .handler(async ({ data }): Promise<LookupAuthMethodsResult> => {
    const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
    const { listIdentityProviders } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const { getRegisteredOidcProviderIds } = await import('@/lib/server/auth/registered-providers')
    const { getConfiguredIntegrationTypes } =
      await import('@/lib/server/domains/platform-credentials/platform-credential.service')
    const { AUTH_CREDENTIAL_PREFIX } = await import('@/lib/server/auth/auth-providers')
    const { resolveLoginRouting } = await import('./auth-routing')

    const tenant = await getTenantSettings()
    const methodsConfig =
      data.surface === 'portal'
        ? (tenant?.publicPortalConfig?.oauth ?? {})
        : (tenant?.publicAuthConfig?.oauth ?? {})

    // Build the liveness snapshot routing needs. `registered` is the
    // canonical registration gate (enabled + creds + tier) from
    // `getRegisteredOidcProviderIds`; `credsPresent` comes from the same
    // cached configured-types Set `buildGenericOAuthConfigs` consults — we
    // reuse those gates rather than re-deriving a different one.
    const providers = await listIdentityProviders()
    const [registeredIds, configuredTypes] = await Promise.all([
      getRegisteredOidcProviderIds(providers),
      getConfiguredIntegrationTypes(),
    ])
    const routable = providers.map((p) => ({
      registrationId: p.registrationId,
      enabled: p.enabled,
      registered: registeredIds.has(p.registrationId),
      credsPresent: configuredTypes.has(`${AUTH_CREDENTIAL_PREFIX}${p.registrationId}`),
      domains: p.domains,
    }))

    // Route to the provider owning the email's verified domain. The
    // liveness gate inside `resolveLoginRouting` falls a dead owner
    // through to `methods` — a disabled / off-tier / secret-less IdP must
    // not dead-redirect, mirroring the pre-registry master switch.
    const routing = resolveLoginRouting(data.email, routable)
    if (routing.kind === 'sso-redirect') {
      return { kind: 'sso-redirect', providerId: routing.providerId }
    }
    if (routing.kind === 'sso-default') {
      return { kind: 'sso-default', providerId: routing.providerId, authConfig: methodsConfig }
    }

    return {
      kind: 'methods',
      authConfig: methodsConfig,
      // SSO is "on" for the form when at least one OIDC provider is live.
      ssoEnabled: registeredIds.size > 0,
    }
  })
