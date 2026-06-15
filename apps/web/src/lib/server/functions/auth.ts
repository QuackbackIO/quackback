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
  /** Verified-domain email AND enforcement is on — must use SSO, no escape. */
  | { kind: 'sso-redirect' }
  /** Verified-domain email AND enforcement is off — SSO is the default
   *  CTA, but the methods form is available as a fallback so users can
   *  pick password / magic-link / OAuth if they prefer. */
  | {
      kind: 'sso-default'
      authConfig: Record<string, boolean | undefined>
    }
  | { kind: 'sso-unavailable'; reason: 'not-registered' }
  | {
      kind: 'methods'
      authConfig: Record<string, boolean | undefined>
      ssoEnabled: boolean
    }

/** User-facing copy for the `sso-unavailable` branch. Centralised so
 *  every login surface renders the same wording when SSO is configured
 *  for a verified domain but isn't actually live at runtime. */
export const SSO_UNAVAILABLE_MESSAGE =
  'Single sign-on is configured for your domain but is not currently available. Contact your administrator.'

export const lookupAuthMethodsFn = createServerFn({ method: 'POST' })
  .validator(lookupAuthMethodsInput)
  .handler(async ({ data }): Promise<LookupAuthMethodsResult> => {
    const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
    const { findVerifiedDomainForEmail, isSsoConfigured } =
      await import('@/lib/server/auth/auth-restrictions')

    const tenant = await getTenantSettings()
    const sso = tenant?.authConfig?.ssoOidc
    const methodsConfig =
      data.surface === 'portal'
        ? (tenant?.publicPortalConfig?.oauth ?? {})
        : (tenant?.publicAuthConfig?.oauth ?? {})

    // Master switch: when SSO is disabled at the workspace level,
    // every downstream toggle (workspace `required`, per-domain
    // `enforced`) is dormant. Common state: admin configured SSO,
    // verified a domain, then flipped `enabled` off (switching IdPs,
    // pausing rollout, simplifying the login form). The verified-
    // domain row + `required` flag outlive the master toggle, but the
    // user-facing message should be "methods", not "sso unavailable" —
    // the latter implies the admin needs to fix something.
    if (!isSsoConfigured(sso)) {
      return {
        kind: 'methods',
        authConfig: methodsConfig,
        ssoEnabled: false,
      }
    }

    // Verified-domain routing applies to both surfaces. Confirm SSO is
    // actually registered (creds present, tier flag on) before promising
    // a redirect — otherwise the user would land on a non-existent
    // provider. When the matching row also has `enforced=true`, the
    // redirect is unconditional (sso-redirect); when off, SSO is the
    // default but the methods form is offered as a fallback (sso-default).
    const match = findVerifiedDomainForEmail(data.email, tenant?.verifiedDomains)
    if (match) {
      const { isSsoActuallyRegistered } = await import('@/lib/server/auth/sso-secret')
      const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
      const registered = await isSsoActuallyRegistered(sso, await getTierLimits())
      if (!registered) {
        return { kind: 'sso-unavailable', reason: 'not-registered' }
      }
      if (match.enforced) {
        return { kind: 'sso-redirect' }
      }
      return { kind: 'sso-default', authConfig: methodsConfig }
    }

    return {
      kind: 'methods',
      authConfig: methodsConfig,
      ssoEnabled: true,
    }
  })
