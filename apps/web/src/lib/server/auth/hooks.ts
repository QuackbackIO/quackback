/**
 * Better-Auth `hooks.before` / `hooks.after` middleware composition.
 *
 * Per-surface enforcement (admin vs portal) can't live at the
 * provider-registration layer because Better-Auth's provider list is
 * global to the auth instance, so we split the policy across three
 * layers, all of which must agree to keep team and portal scopes
 * isolated:
 *   - **Layer A** (auth/index.ts): boot-time registration filter. A
 *     provider is registered iff at least one surface has it enabled.
 *   - **Layer B** (this file, hooks.before): pre-session gate for
 *     endpoints where the email is in `ctx.body` (password, magic-link,
 *     email-OTP). Looks up the calling user's role and consults
 *     `isAuthMethodAllowed`. Throws a redirect on block.
 *   - **Layer C** (this file, hooks.after): post-session compensating
 *     cleanup for OAuth callbacks where the email isn't known until
 *     after the upstream token exchange. setSessionCookie has already
 *     run; on policy reject we delete the session row, clear the
 *     cookie, and redirect.
 */

import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { UserId } from '@quackback/ids'
import type { Role } from '@/lib/shared/roles'
import {
  findProviderForDomainEmail,
  isRegisteredOidcProvider,
  type ProviderWithDomains,
} from './provider-ids'
import { AUTH_BLOCK_MESSAGES } from './redirect-errors'
import { handleRefreshGraceHeal } from './refresh-grace'
import { captureCountryFromHeaders } from './country-capture'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import {
  checkCredentialSignInRateLimit,
  checkMagicLinkSendRateLimit,
  type SignInRateLimiter,
} from './signin-rate-limit'
import { checkAnonMintRateLimit } from './widget-rate-limit'
import {
  computeDeviceFingerprint,
  forgetDevice,
  isDeviceUnseen,
  markDeviceSeen,
} from './signin-device-tracker'
import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'
import { readSsoClaims, readSsoClaimsWithProvenance, type ClaimRead } from './read-sso-claims'
import { applyClaimAttributesAfter } from './apply-claim-attributes'
import { decodeSsoClaims } from './sso-claims-decode'
import { peekResolvedClaims } from './resolved-claims-stash'
import { pickAvatarUrl } from './resolve-identity'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'auth-hooks' })

/**
 * Provider id resolved from the Better-Auth endpoint template + ctx.
 * 'magic-link' covers magic-link send/verify and email-OTP send/verify
 * — they're the same email-bearing method per the spec.
 */
export type AuthProviderId =
  | 'credential' // email + password
  | 'magic-link' // magic-link or email-OTP
  | 'sso' // genericOAuth provider id 'sso'
  | string // social ('google'|'github'|...) or other generic OAuth

/**
 * Map a Better-Auth `ctx.path` template to the conceptual provider id
 * the policy table operates on. Returns `null` for paths that aren't
 * sign-in flows (sign-out, session reads, JWT, MCP OAuth, etc.).
 *
 * Path templates verified against installed Better-Auth 1.6.16 source:
 *   - /sign-in/email                            -> credential
 *   - /sign-in/magic-link                       -> magic-link (send)
 *   - /magic-link/verify                        -> magic-link (verify)
 *   - /email-otp/send-verification-otp          -> magic-link (OTP rides on magic-link)
 *   - /sign-in/email-otp                        -> magic-link (verify)
 *   - /sign-in/social                           -> ctx.body.provider (built-in social)
 *   - /callback/:id                             -> ctx.params.id
 *   - /sign-in/oauth2                           -> ctx.body.providerId (generic OAuth)
 *   - /oauth2/callback/:providerId              -> ctx.params.providerId (incl 'sso')
 */
export function inferProvider(ctx: {
  path?: string
  params?: Record<string, unknown>
  body?: Record<string, unknown>
}): AuthProviderId | null {
  const p = ctx.path
  if (!p) return null
  switch (p) {
    case '/sign-in/email':
    case '/sign-up/email':
      // Sign-up rides the same provider id as sign-in: the policy is
      // identical (verified-domain emails are blocked from password
      // sign-up, just like password sign-in).
      return 'credential'
    case '/sign-in/magic-link':
    case '/magic-link/verify':
    case '/email-otp/send-verification-otp':
    case '/sign-in/email-otp':
      return 'magic-link'
    case '/sign-in/anonymous':
      // The widget's lazy anonymous-session mint. Carries no email, so it's
      // rate-limited per-IP by handleSignInPreCheck, not selectSignInRateLimiter.
      return 'anonymous'
    case '/sign-in/social': {
      const v = ctx.body?.provider
      return typeof v === 'string' ? v : null
    }
    case '/callback/:id': {
      const v = ctx.params?.id
      return typeof v === 'string' ? v : null
    }
    case '/sign-in/oauth2': {
      const v = ctx.body?.providerId
      return typeof v === 'string' ? v : null
    }
    case '/oauth2/callback/:providerId': {
      const v = ctx.params?.providerId
      return typeof v === 'string' ? v : null
    }
    default:
      return null
  }
}

/**
 * Path templates whose endpoints create a session via setSessionCookie
 * AND whose actor identity isn't known until after the upstream
 * round-trip — i.e. the paths Layer B can't gate. Layer C fires here
 * post-session and revokes if the resulting principal/provider fails
 * the policy.
 *
 * `/sign-in/social` is included because Better-Auth's idToken-direct
 * flow (`POST /sign-in/social` with `idToken` in body) creates a
 * session synchronously without going through `/callback/:id` — Layer
 * B can't see the email pre-session, so Layer C is the only gate.
 */
export const SESSION_CREATING_CALLBACK_PATHS = new Set<string>([
  '/callback/:id',
  '/oauth2/callback/:providerId',
  '/sign-in/social',
])

/**
 * Paths where the email isn't in `ctx.body` — Layer B can't gate them
 * because there's no caller identity yet. Layer A (registration filter)
 * and Layer C (compensating cleanup) cover them instead.
 */
const NO_EMAIL_BEFORE_PATHS = new Set<string>([
  '/sign-in/social',
  '/callback/:id',
  '/sign-in/oauth2',
  '/oauth2/callback/:providerId',
])

/**
 * Email-bearing paths that bring a NEW account into existence when no user
 * holds the address yet — the ones `openSignup` is about.
 *
 * `/sign-in/email` is deliberately absent: a password sign-in against an
 * address with no account simply fails, so gating it would turn a wrong
 * password into an account-existence oracle.
 *
 * `/magic-link/verify` is absent for a different reason: it carries its email
 * inside the consumed token rather than in the body, so there is nothing here
 * to gate on. Its send side is listed, and the creation itself is covered by
 * the `user.create.before` backstop in `auth/index.ts`.
 */
const ACCOUNT_CREATING_EMAIL_PATHS = new Set<string>([
  '/sign-up/email',
  '/sign-in/magic-link',
  '/email-otp/send-verification-otp',
  '/sign-in/email-otp',
])

/**
 * Layer B — pre-session per-endpoint gate.
 *
 * Runs for paths where the email is in `ctx.body` (password,
 * magic-link send/verify-by-token, email-OTP send/verify). Looks up
 * the calling user's role and consults `isAuthMethodAllowed`. Throws
 * a redirect on block — the throw is honoured by Better-Auth's
 * middleware machinery and converted into the response.
 *
 * OAuth callback paths (where email isn't yet known) are NOT gated
 * here — their enforcement happens in Layer A (registration filter)
 * and Layer C (compensating cleanup in hooks.after).
 */
/**
 * Pick the rate-limiter for the inferred provider. SSO / OAuth
 * providers aren't rate-limited here — Layer A registration plus
 * IdP-side throttling do the work, and they don't carry an email in
 * the request body.
 */
function selectSignInRateLimiter(provider: AuthProviderId): SignInRateLimiter | null {
  if (provider === 'credential' || provider === 'password') return checkCredentialSignInRateLimit
  if (provider === 'magic-link' || provider === 'email') return checkMagicLinkSendRateLimit
  return null
}

/**
 * Body of the Layer B pre-session gate, exported separately from the
 * Better-Auth middleware wrapper so it can be unit-tested without
 * spinning up the full auth instance. `hooksBefore` is just a thin
 * createAuthMiddleware around this.
 */
export async function handleSignInPreCheck(ctx: {
  path?: string
  params?: Record<string, unknown>
  body?: Record<string, unknown>
  redirect: (url: string) => Error
}): Promise<void> {
  const provider = inferProvider(ctx as Parameters<typeof inferProvider>[0])
  if (!provider) return

  if (process.env.AUTH_HOOKS_DEBUG === '1') {
    log.debug({ path: ctx.path, provider }, 'sign-in pre-check')
  }

  if (NO_EMAIL_BEFORE_PATHS.has(ctx.path ?? '')) return

  // The anonymous mint carries no email, so it can't ride the per-email
  // limiters below — bound it per-IP here instead. Without this, the widget's
  // open mint endpoint is an unmetered way to flood the session table.
  if (provider === 'anonymous') {
    const mintIp = getClientIp(getRequestHeaders())
    const mintResult = await checkAnonMintRateLimit(mintIp).catch((error) => {
      log.error({ err: error }, 'anon-mint rate-limit check threw; failing open')
      return { allowed: true as const }
    })
    if (!mintResult.allowed) {
      throw new APIError(
        'TOO_MANY_REQUESTS',
        { code: 'rate_limited', message: AUTH_BLOCK_MESSAGES.rate_limited },
        mintResult.retryAfter ? { 'Retry-After': String(mintResult.retryAfter) } : undefined
      )
    }
    return
  }

  const body = ctx.body as { email?: unknown } | undefined
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
  if (!email) return

  // The reserved placeholder domain is never a real address: it backs the
  // synthetic ones minted for principals that have no email. Refuse it at
  // every email-bearing entry point so a placeholder cannot be pre-registered
  // by whoever derives it — provider-scoped placeholders are computed from
  // public subjects, and a squatter would permanently block the real identity
  // from linking while being unable to verify the address either, since the
  // transport refuses to deliver there.
  //
  // Checked before the workspace load and the rate limiter: it is the cheapest
  // possible rejection and it keeps the reserved domain out of the rate-limit
  // keyspace.
  if (isSyntheticAnonEmail(email)) {
    throw ctx.redirect('/?auth=signin&error=reserved_email_domain')
  }

  // Rate-limit before any DB load. Generic redirect on block so the
  // response doesn't leak which dimension hit the cap. Sequential
  // with the workspace fetch so a DB hiccup can't mask a 429 with a 500.
  const headers = getRequestHeaders()
  const ip = getClientIp(headers)
  const rateLimiter = selectSignInRateLimiter(provider)
  const rateLimitResult: Awaited<ReturnType<SignInRateLimiter>> = rateLimiter
    ? await rateLimiter(ip, email).catch((error) => {
        log.error({ err: error }, 'rate-limit check threw; failing open')
        return { allowed: true }
      })
    : { allowed: true }
  if (!rateLimitResult.allowed) {
    try {
      const { recordAuditEvent } = await import('@/lib/server/audit/log')
      await recordAuditEvent({
        event: 'auth.signin.rate_limited',
        outcome: 'failure',
        actor: { email },
        headers,
        metadata: { retryAfter: rateLimitResult.retryAfter, provider },
      })
    } catch (auditErr) {
      log.error({ err: auditErr }, 'rate-limit audit emit failed')
    }
    // 429 JSON instead of a 302 redirect: sign-in submits are XHR, and
    // the redirect-then-detect pattern depends on `response.redirected`
    // being set by the browser fetch. That's reliable in modern browsers
    // but added one indirection between the server's intent ("rate limited")
    // and the message the form displays ("Invalid email or password"
    // fallback when something in that chain misfires). A direct 429 with
    // `{ code, message }` is what Better-Auth's auth client surfaces as
    // `result.error.message`, which the form already renders verbatim.
    throw new APIError(
      'TOO_MANY_REQUESTS',
      { code: 'rate_limited', message: AUTH_BLOCK_MESSAGES.rate_limited },
      rateLimitResult.retryAfter ? { 'Retry-After': String(rateLimitResult.retryAfter) } : undefined
    )
  }

  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const workspace = await getWorkspaceSettings()

  const { isHardBound, isAuthMethodAllowed } = await import('./auth-restrictions')

  // Look up the principal early — `isAuthMethodAllowed` below needs the
  // role to pick the right per-audience method gate. Brand-new sign-ups
  // (no user row yet) get role='user' so the per-domain branch still
  // gates them via email lookup — `isHardBound` does not depend on
  // role anymore.
  const { db, user: userTable, principal: principalTable, eq } = await import('@/lib/server/db')
  type UserId = `user_${string}`
  const userRow = await db.query.user.findFirst({
    where: eq(userTable.email, email),
    columns: { id: true },
  })
  const principalRow = userRow
    ? await db.query.principal.findFirst({
        where: eq(principalTable.userId, userRow.id as UserId),
        columns: { role: true },
      })
    : null
  const role = (principalRow?.role ?? 'user') as Role

  // Load the provider registry once: both the owning-provider resolution
  // for hard-binding and the per-method gate consult it. `registeredOidcIds`
  // lets `isHardBound` fail open (scoped to the owning provider) on
  // tier-downgrade / missing-secret states so admins aren't self-locked-out.
  const { listIdentityProviders } =
    await import('@/lib/server/domains/settings/identity-providers.service')
  const { getRegisteredOidcProviderIds } = await import('./registered-providers')
  const providers = await listIdentityProviders()
  const registeredOidcIds = await getRegisteredOidcProviderIds(providers)

  // Hard-binding: refuses password / magic-link / email-OTP for
  // emails at a verified-domain row marked enforced (per-domain).
  // The verified-domain branch fires before user lookup matters —
  // inbox control at the verified domain shouldn't bypass the IdP's
  // attestations even for brand-new sign-ups.
  if (isHardBound(provider, email, providers, registeredOidcIds)) {
    throw ctx.redirect('/?auth=signin&callbackUrl=/admin&error=verified_domain_requires_sso')
  }

  // `openSignup`, enforced. Only for the paths that would CREATE an account and
  // only when no user holds the address — the same exemption the policy itself
  // opens with, checked here so the common case costs no extra query.
  //
  // Sits after hard-binding, which is the stronger statement about the same
  // attempt and should be the one reported, and before the `!principalRow`
  // return below — that early exit exists for exactly the brand-new sign-up
  // this gate is about, so a gate placed after it would never run.
  //
  // This redirect IS distinguishable per address: an address that holds an
  // account, or that a pending invitation names, gets the endpoint's normal
  // answer instead. It is bounded rather than closed, because it sits behind
  // the magic-link limiter above — 3 per (ip, address) per 15 minutes and 20
  // per IP — which is spent before the question is asked, so probing costs the
  // same budget as sending. `/api/auth/portal-signin` is the same question
  // asked without a limiter in front of it, which is why that route answers
  // identically either way and mails the refusal instead.
  //
  // The PORTAL door, because nothing here names an audience and the creation
  // does. This gate sits before the `!principalRow` return by design, so there
  // is no role to read; the four gated paths are each reachable from the portal
  // dialog and the team login alike, and the one body field that would hint —
  // `callbackURL` — is sent by none of this app's callers of them and is chosen
  // by whoever is asking, so honouring it would let a caller pick which of the
  // workspace's two answers to be judged by. What settles it is what the
  // request would produce: `user.create.after` writes `role: 'user'` for every
  // new account without consulting anything, so this creates a portal account
  // or nothing. Team membership arrives by invitation or the bootstrap claim,
  // and the policy exempts both.
  if (!userRow && ACCOUNT_CREATING_EMAIL_PATHS.has(ctx.path ?? '')) {
    const { isAccountCreationAllowed, SIGNUP_NOT_ALLOWED } = await import('./signup-policy')
    if (!(await isAccountCreationAllowed(email, 'portal'))) {
      throw ctx.redirect(`/?auth=signin&error=${SIGNUP_NOT_ALLOWED}`)
    }
  }

  if (!principalRow) return

  const result = await isAuthMethodAllowed(provider, role, registeredOidcIds, workspace)
  if (!result.allowed) {
    const isTeamRole = role === 'admin' || role === 'member'
    const errorCode = result.error ?? 'auth_method_blocked'
    // Team roles land on the unified login with a `/admin` callback (the
    // break-glass form); the error rides as a second param via `&` — a
    // second `?` would silently drop it. Portal roles keep the plain
    // `/?auth=signin&error=` shape. All paths go directly to `/?auth=signin`
    // so the auth client's detectAuthBlockRedirect can match on the
    // error code regardless of the redirect chain.
    throw ctx.redirect(
      isTeamRole
        ? `/?auth=signin&callbackUrl=/admin&error=${errorCode}`
        : `/?auth=signin&error=${errorCode}`
    )
  }
}

export const hooksBefore = createAuthMiddleware(async (ctx) => {
  // Disjoint path matchers: grace heal only touches /oauth2/token,
  // sign-in pre-check only touches sign-in/OTP paths. Order is irrelevant.
  await handleRefreshGraceHeal(ctx)
  await handleSignInPreCheck(ctx as Parameters<typeof handleSignInPreCheck>[0])
})

/**
 * OIDC callback post-processing — runs for any registered OIDC provider's
 * callback (the genericOAuth path `/oauth2/callback/:providerId`).
 *
 * Two responsibilities:
 *
 * 1. **Bootstrap-only admin promotion.** Replaces the buggy
 *    `databaseHooks.account.create.after` block in auth/index.ts that
 *    upgraded *every* SSO sign-in to admin. The new behavior: only the
 *    first OIDC sign-in into a workspace with no existing admin claims
 *    admin. Wraps in a transaction with `pg_advisory_xact_lock` so
 *    concurrent first-sign-ins don't race the existing-admin
 *    check. Recovery-scoped — a healthy workspace post-onboarding
 *    always has an admin so this is a no-op.
 *
 * 2. **`lastSsoSignInAt` write.** Read by `setVerifiedDomainEnforcedFn`'s
 *    bootstrap guard to refuse turning per-domain enforcement on
 *    without a recent SSO sign-in. Written here on every successful
 *    OIDC callback (newSession exists). Link callbacks have no
 *    newSession and are correctly skipped — explicit account-link
 *    isn't a sign-in.
 *
 * H8 (Task 13): bootstrap promotion is restricted to a callback whose
 * IdP-asserted email is at a verified domain OWNED BY THE CALLBACK
 * PROVIDER (see {@link shouldBootstrapPromote}). A public, button-only
 * provider (no verified domains) never triggers promotion — otherwise the
 * first internet visitor to a declared public provider would seize admin
 * on a fresh / recovered workspace. The `lastSsoSignInAt` stamp is
 * provider-independent (it lives on `principal`) and runs unconditionally.
 *
 * On top of H8, promotion also requires `isOpenToBootstrapClaim`: on a
 * workspace a control plane created, the owner is recorded where it was
 * created and arriving is not how the admin is decided, whatever the IdP
 * attests. The cost is that such a workspace cannot recover a deleted admin
 * through SSO — it recovers through the control plane that owns it, which is
 * the same place its owner came from.
 */
export async function handleSsoCallbackAfter(
  ctx: {
    path?: string
    params?: Record<string, unknown>
    context?: {
      newSession?: { user?: { id?: string; email?: string }; session?: { token?: string } } | null
    }
  },
  /** OIDC provider ids registered right now (from getRegisteredOidcProviderIds). */
  registeredOidcIds: Set<string>,
  /** Identity providers + their verified domains (from listIdentityProviders).
   *  Used to resolve the callback provider for the H8 promotion gate. */
  providers: readonly ProviderWithDomains[]
): Promise<void> {
  if (ctx.path !== '/oauth2/callback/:providerId') return
  const providerId = ctx.params?.providerId
  if (typeof providerId !== 'string' || !isRegisteredOidcProvider(providerId, registeredOidcIds))
    return
  const userId = ctx.context?.newSession?.user?.id
  if (typeof userId !== 'string' || userId.length === 0) return
  const email = ctx.context?.newSession?.user?.email

  // H8: resolve the callback provider and decide promotion eligibility BEFORE
  // the lock window. Eligible only when the email is at one of THIS provider's
  // verified domains — a button-only provider yields `false`.
  const callbackProvider = providers.find((p) => p.registrationId === providerId)
  const eligibleForBootstrap = shouldBootstrapPromote(email, callbackProvider)

  const { db } = await import('@/lib/server/db')
  const { bootstrapAdminLock, findHumanAdmin, isOpenToBootstrapClaim } =
    await import('@/lib/server/domains/principals/bootstrap-admin')
  const { setPrincipalRole, updatePrincipalFields } =
    await import('@/lib/server/domains/principals/principal.factory')
  // Cast through the typeid-branded type so Drizzle's eq() narrows.
  type UserId = `user_${string}`
  const userIdTyped = userId as UserId

  // Captured inside the tx (only the role promotion busts), drained after commit.
  let bootstrapCacheKeys: readonly string[] = []
  await db.transaction(async (tx) => {
    // The shared bootstrap lock, not a private one: this path and the
    // onboarding workspace step both hand out the first admin, and two
    // different lock keys exclude nothing. Released on commit.
    await tx.execute(bootstrapAdminLock())

    // Bootstrap admin promotion: only fires when the H8 gate passed AND no
    // human admin exists. A healthy workspace post-/admin/setup always has
    // one, so this branch is recovery-scoped (deleted admin, skipped
    // onboarding, config-file provisioning before any admin existed).
    if (eligibleForBootstrap) {
      // The same three facts the onboarding promoter and the unauthenticated
      // claim screen decide on, asked on the same transaction inside the same
      // lock. Two of them used to be asked here and the third was not, which
      // is the disagreement the shared module exists to prevent, inverted: the
      // screen told the browser `openToClaim: false` while this path promoted
      // the first arrival anyway.
      const [existingAdmin, openToClaim] = await Promise.all([
        findHumanAdmin(tx),
        isOpenToBootstrapClaim(tx),
      ])
      if (!existingAdmin && !openToClaim) {
        log.warn(
          { user_id: userId, provider_id: providerId },
          'sso bootstrap admin promotion refused: workspace is provisioned'
        )
      }
      if (!existingAdmin && openToClaim) {
        const { cacheKeysToBust } = await setPrincipalRole({ userId: userIdTyped }, 'admin', {
          executor: tx,
        })
        bootstrapCacheKeys = cacheKeysToBust
        log.info({ user_id: userId }, 'sso bootstrap admin promotion')
      }
    }

    // Stamp lastSsoSignInAt for the bootstrap guard's window check.
    // Run in the same tx so the lock window covers both writes; the
    // promotion path needs the timestamp first so the same admin can
    // immediately enable enforcement.
    await updatePrincipalFields(
      { userId: userIdTyped },
      { lastSsoSignInAt: new Date() },
      { executor: tx }
    )
  })

  if (bootstrapCacheKeys.length) {
    const { cacheDel } = await import('@/lib/server/cache')
    await cacheDel(...bootstrapCacheKeys)
  }
}

/**
 * H8 decision (pure) — may the first OIDC sign-in via `callbackProvider`
 * claim bootstrap admin? Only when the IdP-asserted `email` is at one of
 * THIS provider's VERIFIED domains. A button-only provider (no verified
 * domains) always returns `false`, so a public IdP can never seize admin.
 *
 * Extracted so the privilege-escalation rule is unit-testable without a
 * full DB exercise. {@link handleSsoCallbackAfter} consults it.
 */
export function shouldBootstrapPromote(
  email: string | null | undefined,
  callbackProvider: ProviderWithDomains | undefined
): boolean {
  if (!callbackProvider) return false
  return findProviderForDomainEmail(email, [callbackProvider]) !== null
}

/**
 * Auto-provision SSO users to a role on first OIDC sign-in.
 *
 * Fires on any registered OIDC provider's callback
 * (`/oauth2/callback/:providerId`). The IdP's assertion of email + identity
 * is the trust source; magic-link to a verified-domain email is hard-bound
 * in `hooksBefore` so it never reaches this path, and password/social
 * callbacks are likewise blocked.
 *
 * Two trust paths decide the role, each with its own scoping:
 *  - CLAIM-MATCHED: when the provider has a `claimMapping.role` and a rule
 *    matches the user's claim, the IdP is attesting THIS user's role — a
 *    per-user signal — so the role is assigned regardless of the email's
 *    domain. This is the primary path for enterprise IdPs that emit group/
 *    role claims (mirrors how WorkOS et al. assign roles).
 *  - DEFAULT-ROLE FALLBACK: when no rule matches (or no mapping is set), the
 *    role falls back to the provider's `autoProvisionRole` (default
 *    `'member'`). That is NOT a per-user attestation, so it stays scoped to
 *    the CALLBACK provider's own verified domains — a sign-in via provider X
 *    only provisions when the email is at one of X's verified domains. Mere
 *    inbox control isn't enough to claim team membership.
 *
 * Provisioning config is read from the MATCHED PROVIDER ROW (`autoCreateUsers`
 * / `autoProvisionRole` / `claimMapping`), never another provider's.
 *
 * Invariants:
 *  - Only upgrades from `role='user'`; `admin` and `member` are left
 *    alone unless `claimMapping.role.syncOnEverySignIn` is set. The special
 *    `autoProvisionRole='user'` disables default-role promotion entirely.
 *  - A returning user with no principal row (soft-removed via "Remove from
 *    portal", which keeps the auth identity) is treated as a fresh sign-in:
 *    the principal is recreated in-band with the provisioned role rather than
 *    updating zero rows and falling back to a plain `'user'`.
 *  - `autoCreateUsers=false` short-circuits — the admin opted out.
 *  - Bootstrap-admin from `handleSsoCallbackAfter` runs first; if
 *    that promoted the user to `admin`, the role-check here skips.
 */
export async function handleAutoProvisionAfter(
  ctx: {
    path?: string
    params?: Record<string, unknown>
    context?: {
      newSession?: { user?: { id?: string; email?: string } } | null
    }
  },
  /** Identity providers + their verified domains (from listIdentityProviders).
   *  The matched row supplies the per-provider provisioning config. */
  providers: Awaited<
    ReturnType<
      typeof import('@/lib/server/domains/settings/identity-providers.service').listIdentityProviders
    >
  >,
  /** OIDC provider ids registered right now (from getRegisteredOidcProviderIds). */
  registeredOidcIds: Set<string>,
  /** Shared per-callback claim reader. Omitted, falls back to `readSsoClaims`. */
  readClaims?: () => Promise<ClaimRead>
): Promise<void> {
  if (ctx.path !== '/oauth2/callback/:providerId') return
  const providerId = ctx.params?.providerId
  if (typeof providerId !== 'string' || !isRegisteredOidcProvider(providerId, registeredOidcIds))
    return

  const userId = ctx.context?.newSession?.user?.id
  const email = ctx.context?.newSession?.user?.email
  if (typeof userId !== 'string' || typeof email !== 'string') return

  // Read the matched provider row — provisioning config is per-provider.
  const provider = providers.find((p) => p.registrationId === providerId)
  if (!provider) return
  if (!provider.autoCreateUsers) return

  const { db, principal: principalTable, user: userTable, eq } = await import('@/lib/server/db')
  const { setPrincipalRole, ensurePrincipalForUser } =
    await import('@/lib/server/domains/principals/principal.factory')
  type UserId = `user_${string}`
  const userIdTyped = userId as UserId

  // Resolve the role from IdP claims FIRST, independent of any verified-domain
  // check. An explicit claim match is the IdP attesting THIS user's role — a
  // per-user signal stronger than domain ownership — so it provisions even when
  // the email is not at one of the provider's verified domains.
  const { roleMappingFor } = await import('@/lib/shared/oidc-claim-mapping')
  const roleMapping = roleMappingFor(provider.claimMapping)
  let claimRole: Role | null = null
  if (roleMapping) {
    // Role resolution is indifferent to provenance: a role claim absent from
    // the stored token yields the default role either way.
    const claims = readClaims
      ? (await readClaims()).claims
      : await readSsoClaims(userIdTyped, providerId)
    const { resolveSsoRole } = await import('./resolve-sso-role')
    claimRole = resolveSsoRole(claims, roleMapping)
  }

  // The default role (no claim matched) is NOT a per-user attestation, so it
  // stays scoped to the CALLBACK provider's own verified domains: without the
  // IdP asserting this user's role, mere inbox control isn't enough to claim
  // team membership. A claim-matched role bypasses this gate.
  if (claimRole === null && findProviderForDomainEmail(email, [provider]) === null) return

  const targetRole: Role = claimRole ?? provider.autoProvisionRole ?? 'member'

  const p = await db.query.principal.findFirst({
    where: eq(principalTable.userId, userIdTyped),
    columns: { role: true },
  })

  // A missing principal is a returning user whose row was soft-removed
  // ("Remove from portal" deletes the principal, not the auth identity, so the
  // user.create hook never re-fires). Treat it as a fresh first sign-in so the
  // role still applies — otherwise the UPDATE below would touch zero rows and
  // the lazy getOptionalAuth path would recreate them as a plain 'user'.
  const currentRole = p?.role ?? 'user'

  // Sync mode: re-apply on every sign-in, including for existing
  // admin/member users. Without sync, JIT semantics — only a fresh
  // first sign-in (role='user') gets touched.
  const syncOnEverySignIn = roleMapping?.syncOnEverySignIn === true
  if (!syncOnEverySignIn && currentRole !== 'user') return

  // 'user' as the target is the explicit no-promote choice — only
  // demote an existing team-role user to 'user' under sync mode.
  if (targetRole === 'user' && !syncOnEverySignIn) return

  if (currentRole === targetRole) return // no-op, save the write

  if (p) {
    // No tx -> the factory busts PRINCIPAL_BY_USER itself.
    await setPrincipalRole({ userId: userIdTyped }, targetRole)
  } else {
    // Recreate the soft-removed principal in-band with the provisioned role.
    // Display fields come from the auth user so the rebuilt principal matches
    // what the lazy creation path would have produced.
    const u = await db.query.user.findFirst({
      where: eq(userTable.id, userIdTyped),
      columns: { name: true, image: true },
    })
    // ensurePrincipalForUser wins the documented race vs getOptionalAuth's lazy
    // 'user' create. Stamp lastSsoSignInAt on the rebuilt row — the bootstrap
    // UPDATE ran first and missed it while the principal didn't exist.
    const { created, principal: rebuilt } = await ensurePrincipalForUser({
      userId: userIdTyped,
      role: targetRole,
      displayName: u?.name ?? null,
      avatarUrl: u?.image ?? null,
      lastSsoSignInAt: new Date(),
    })
    // If a concurrent lazy create won the race it seeded role 'user'; reapply the
    // provisioned role so the SSO attestation isn't silently dropped.
    if (!created && rebuilt.role !== targetRole) {
      await setPrincipalRole({ userId: userIdTyped }, targetRole)
    }
  }

  if (p?.role && p.role !== targetRole) {
    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    await recordAuditEvent({
      event: 'user.role.changed',
      outcome: 'success',
      actor: { email: email ?? null }, // SSO callback — no authenticated admin actor
      target: { type: 'user', id: userIdTyped },
      before: { role: p.role },
      after: { role: targetRole },
      metadata: { source: roleMapping ? 'claim_mapping' : 'auto_provision' },
    })
  }

  log.info({ user_id: userId, role: targetRole }, 'auto-provisioned verified-domain user via sso')
}

type IdpRows = Awaited<
  ReturnType<
    typeof import('@/lib/server/domains/settings/identity-providers.service').listIdentityProviders
  >
>

/**
 * Resolve a provider's userinfo endpoint: the manual URL if set, else the
 * `userinfo_endpoint` from its discovery document. SSRF-guarded, best-effort.
 */
async function resolveUserInfoEndpoint(
  provider: IdpRows[number] | undefined
): Promise<string | null> {
  if (!provider) return null
  if (provider.userInfoUrl) return provider.userInfoUrl
  if (!provider.discoveryUrl) return null
  try {
    const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
    const res = await safeFetch(provider.discoveryUrl, { timeoutMs: 5000 })
    if (!res.ok) return null
    const doc: unknown = await res.json()
    const endpoint = (doc as { userinfo_endpoint?: unknown } | null)?.userinfo_endpoint
    return typeof endpoint === 'string' ? endpoint : null
  } catch {
    return null
  }
}

/** Fetch a userinfo document with the bearer token. Best-effort. */
async function fetchUserInfoDoc(
  url: string,
  accessToken: string
): Promise<Record<string, unknown> | null> {
  try {
    const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
    const res = await safeFetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: 5000,
    })
    if (!res.ok) return null
    const body: unknown = await res.json()
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Fill `user.image` from the SSO `picture` claim — but only when the account
 * has no avatar yet.
 *
 * Better-Auth's genericOAuth writes `image` only when it CREATES the user, and
 * we deliberately leave `overrideUserInfo` off ("set once, never clobber a
 * picture the user chose in Quackback"). Neither covers the common case: an
 * account that already existed before the workspace's IdP started returning a
 * `picture`, or before this feature shipped. This closes that gap without ever
 * overwriting a non-empty avatar.
 *
 * `picture` is sourced, in order:
 *   1. the request's resolved claims (peeked, not consumed, so role
 *      provisioning still takes its copy) — the free path;
 *   2. the stored ID token;
 *   3. a live userinfo call with the just-issued access token — the
 *      deterministic path for an IdP that exposes `picture` only at userinfo,
 *      where (1) can miss if role provisioning drained the stash first.
 *
 * Runs BEFORE `handleAutoProvisionAfter` so the peek in (1) sees the stash.
 */
export async function handleAvatarBackfillAfter(
  ctx: {
    path?: string
    params?: Record<string, unknown>
    context?: { newSession?: { user?: { id?: string } } | null }
  },
  registeredOidcIds: Set<string>,
  providers: IdpRows
): Promise<void> {
  if (ctx.path !== '/oauth2/callback/:providerId') return
  const providerId = ctx.params?.providerId
  if (typeof providerId !== 'string' || !isRegisteredOidcProvider(providerId, registeredOidcIds))
    return
  const userId = ctx.context?.newSession?.user?.id
  if (typeof userId !== 'string' || userId.length === 0) return
  type UserId = `user_${string}`
  const userIdTyped = userId as UserId

  const { db, user: userTable, account, and, eq, desc } = await import('@/lib/server/db')

  const owner = await db.query.user.findFirst({
    where: eq(userTable.id, userIdTyped),
    columns: { image: true },
  })
  // Only fill an empty avatar — never replace one the user set.
  if (!owner || (typeof owner.image === 'string' && owner.image.trim() !== '')) return

  const row = await db.query.account.findFirst({
    where: and(eq(account.userId, userIdTyped), eq(account.providerId, providerId)),
    columns: { idToken: true, accountId: true, accessToken: true },
    orderBy: desc(account.createdAt),
  })

  const stashed = row?.accountId ? peekResolvedClaims(providerId, row.accountId) : null
  let image = pickAvatarUrl(stashed ?? decodeSsoClaims(row?.idToken))

  // Last resort: ask userinfo directly. `picture` frequently lives only there,
  // and the stash can be gone by now.
  if (!image && row?.accessToken) {
    const endpoint = await resolveUserInfoEndpoint(
      providers.find((p) => p.registrationId === providerId)
    )
    if (endpoint) {
      image = pickAvatarUrl((await fetchUserInfoDoc(endpoint, row.accessToken)) ?? {})
    }
  }

  if (!image) return

  await db.update(userTable).set({ image }).where(eq(userTable.id, userIdTyped))
  log.info({ user_id: userId, provider_id: providerId }, 'backfilled sso avatar')
}

/**
 * Layer C — post-session compensating cleanup for OAuth callbacks.
 *
 * `hooks.after` for `/callback/:id` and `/oauth2/callback/:providerId`
 * runs *after* `setSessionCookie` has already written the cookie and
 * populated `ctx.context.newSession`. We can't gate these paths in
 * `hooks.before` because the email isn't known until the upstream
 * token exchange completes, which only happens in the endpoint
 * handler. So: let the session be created, then check the resulting
 * principal's role + provider against the policy. If blocked, delete
 * the just-created session row, clear the cookie via Better-Auth's
 * own `deleteSessionCookie` helper, and throw a redirect.
 *
 * The only legitimate cost is one DB insert + immediate delete on
 * the rare blocked path — acceptable for the security guarantee.
 */
type SessionCtx = Parameters<typeof import('better-auth/cookies').deleteSessionCookie>[0]

/**
 * Drop a freshly-created session: delete the row, clear the cookie,
 * and null out `ctx.context.newSession` so any after-hook later in the
 * chain that reads it (handleCountryCapture, future country-aware
 * side-effects, etc.) can't act on a revoked session by mistake.
 *
 * Better Auth populates `ctx.context.newSession` when the verify path
 * mints a session, and our callbacks don't clear it on revoke unless we
 * do it here — every revoke path must funnel through this helper.
 */
export async function revokeSession(ctx: SessionCtx, token: string): Promise<void> {
  const { db, session: sessionTable, eq } = await import('@/lib/server/db')
  await db.delete(sessionTable).where(eq(sessionTable.token, token))
  const { deleteSessionCookie } = await import('better-auth/cookies')
  deleteSessionCookie(ctx)
  const ctxWithNewSession = ctx as SessionCtx & {
    context?: { newSession?: unknown | null }
  }
  if (ctxWithNewSession.context && 'newSession' in ctxWithNewSession.context) {
    ctxWithNewSession.context.newSession = null
  }
}

export async function handleCallbackPolicyCleanup(
  ctx: {
    path?: string
    params?: Record<string, unknown>
    body?: Record<string, unknown>
    context?: {
      newSession?: {
        user?: { id?: string; email?: string }
        session?: { token?: string }
      } | null
    }
    redirect: (url: string) => Error
    setCookie?: (name: string, value: string, opts?: Record<string, unknown>) => string
  },
  workspace: Awaited<
    ReturnType<typeof import('@/lib/server/domains/settings/settings.service').getWorkspaceSettings>
  >,
  /** Identity providers + their verified domains (from listIdentityProviders). */
  providers: Awaited<
    ReturnType<
      typeof import('@/lib/server/domains/settings/identity-providers.service').listIdentityProviders
    >
  >,
  /** OIDC provider ids registered right now (from getRegisteredOidcProviderIds). */
  registeredOidcIds: Set<string>
): Promise<void> {
  if (!SESSION_CREATING_CALLBACK_PATHS.has(ctx.path ?? '')) return
  const userId = ctx.context?.newSession?.user?.id
  const userEmail = ctx.context?.newSession?.user?.email
  const token = ctx.context?.newSession?.session?.token
  if (typeof userId !== 'string' || typeof token !== 'string') return

  const provider = inferProvider(ctx as Parameters<typeof inferProvider>[0])
  if (!provider) return

  const {
    db,
    principal: principalTable,
    user: userTable,
    account: accountTable,
    eq,
  } = await import('@/lib/server/db')
  type UserId = `user_${string}`

  const { isHardBound, isAuthMethodAllowed, isSsoBlockedForRole } =
    await import('./auth-restrictions')

  // Look up the principal once — both the role-aware redirect (for the
  // hard-binding branch) and the role-based policy check (below) need it.
  const principalRow = await db.query.principal.findFirst({
    where: eq(principalTable.userId, userId as UserId),
    columns: { role: true },
  })
  const role = (principalRow?.role ?? 'user') as Role
  const isTeamRole = role === 'admin' || role === 'member'
  // Team roles route to the unified login carrying a `/admin` callback
  // (the break-glass form); the error joins with `&` so it isn't lost
  // behind a second `?`. Portal roles keep the plain `?error=` shape.
  // All targets go directly to `/?auth=signin` so detectAuthBlockRedirect
  // matches on the error code without following a redirect stub.
  const blockedRedirect = (errorCode: string) =>
    ctx.redirect(
      isTeamRole
        ? `/?auth=signin&callbackUrl=/admin&error=${errorCode}`
        : `/?auth=signin&error=${errorCode}`
    )

  // Drop the user/account/principal rows iff the user record is brand-
  // new (created within the last 60s). Both blocking branches below
  // call this so a first-time blocked sign-up doesn't leak orphan rows
  // into the workspace. Existing users keep their rows — they have
  // history elsewhere (posts, votes, audit) that we don't want to break.
  const wipeBrandNewShellsIfFresh = async () => {
    const userRow = await db.query.user.findFirst({
      where: eq(userTable.id, userId as UserId),
      columns: { createdAt: true },
    })
    const justCreated = userRow?.createdAt && Date.now() - userRow.createdAt.getTime() < 60_000
    if (!justCreated) return
    await db.delete(accountTable).where(eq(accountTable.userId, userId as UserId))
    await db.delete(principalTable).where(eq(principalTable.userId, userId as UserId))
    await db.delete(userTable).where(eq(userTable.id, userId as UserId))
  }

  // Revoke the just-created session, drop brand-new shells, and redirect.
  // Shared by every reject branch below.
  const blockSignIn = async (errorCode: string): Promise<never> => {
    await revokeSession(ctx as SessionCtx, token)
    await wipeBrandNewShellsIfFresh()
    throw blockedRedirect(errorCode)
  }

  // Hard-binding: blocks any callback whose email is at an enforced verified
  // domain UNLESS the callback IS that domain's owning provider. This is the
  // gate that catches social / a *different* OIDC provider for emails at an
  // enforced domain — Layer B can't (no email pre-session on callback paths).
  // `isHardBound` exempts the owning provider's own callback internally, so
  // no `provider !== 'sso'` guard is needed; it also fails open (scoped to
  // the owner) when the owning IdP isn't registered, per its docstring.
  if (
    typeof userEmail === 'string' &&
    isHardBound(provider, userEmail, providers, registeredOidcIds)
  ) {
    await blockSignIn('verified_domain_requires_sso')
  }

  // Portal OIDC eligibility: a portal user completing provider X's callback
  // must be at one of X's verified domains (see `isSsoBlockedForRole`). The
  // login UI only offers a provider on a verified-domain match, but a direct
  // /sign-in/oauth2 start skips that routing, so this callback is the gate.
  // Sits with the hard-binding gate above the principal-row guard: it's an
  // email-driven policy, and `role` defaulting to 'user' (the most
  // restrictive audience) keeps it fail-closed if the principal is missing.
  if (
    isRegisteredOidcProvider(provider, registeredOidcIds) &&
    isSsoBlockedForRole(role, userEmail, provider, providers)
  ) {
    await blockSignIn('oauth_method_not_allowed')
  }

  if (!principalRow) return

  const result = await isAuthMethodAllowed(provider, role, registeredOidcIds, workspace)
  if (result.allowed) return

  await blockSignIn(result.error ?? 'auth_method_blocked')
}

/**
 * Audit emitter for user-initiated 2FA enrollment / removal.
 *
 * The `AuditEventType` union has carried `two_factor.enabled` and
 * `two_factor.disabled` since Phase A, but nothing was actually
 * emitting them — only the admin-reset path was audited. This closes
 * the SOC2 trail for self-service 2FA lifecycle events.
 *
 * Signal:
 *  - `/two-factor/verify-totp` with `ctx.context.newSession` populated
 *    is BA's enrollment path. The "first verify" branch in the plugin
 *    issues a fresh session via `setSessionCookie`; the sign-in
 *    challenge branch (already-enrolled user verifying during
 *    sign-in) does not touch sessions, so `newSession` is absent.
 *    That's the cleanest in-band distinguisher between enrollment
 *    and challenge without parsing BA's response body.
 *  - `/two-factor/disable` always means a deliberate teardown — both
 *    the BA endpoint and our UI require a fresh password confirmation
 *    upstream, so reaching this hook implies success.
 *
 * Wrapped in try/catch so an audit-store outage can't break the user's
 * sign-in / settings page — mirrors `handleSignInSuccessAudit`.
 */
const TWO_FACTOR_AUDIT_PATHS = {
  enrollComplete: '/two-factor/verify-totp',
  disable: '/two-factor/disable',
} as const

export async function handleTwoFactorLifecycleAudit(ctx: {
  path?: string
  context?: {
    session?: {
      user?: { id?: string; email?: string }
    } | null
    newSession?: {
      user?: { id?: string; email?: string }
      session?: { token?: string }
    } | null
  }
}): Promise<void> {
  const path = ctx.path
  const isEnrollment =
    path === TWO_FACTOR_AUDIT_PATHS.enrollComplete &&
    typeof ctx.context?.newSession?.session?.token === 'string'
  const isDisable = path === TWO_FACTOR_AUDIT_PATHS.disable
  if (!isEnrollment && !isDisable) return

  const actor = isEnrollment ? ctx.context?.newSession?.user : ctx.context?.session?.user
  const userId = actor?.id
  if (typeof userId !== 'string') return

  try {
    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    await recordAuditEvent({
      event: isEnrollment ? 'two_factor.enabled' : 'two_factor.disabled',
      outcome: 'success',
      actor: {
        userId: userId as `user_${string}`,
        email: actor?.email ?? null,
      },
      headers: getRequestHeaders(),
    })
  } catch (error) {
    log.error({ err: error }, 'two-factor lifecycle audit emit failed')
  }
}

/**
 * Sign-in failure audit emitter.
 *
 * Fires in the after-hook chain when a sign-in path was hit but no
 * session was created — the canonical signal of a failed credential
 * or magic-link attempt. Emits `auth.signin.failed` with a stable
 * reason code derived from the response status / body when available.
 *
 * OWASP PII guard: only the attempted email and a stable reason code
 * are logged. Passwords, tokens, and credential material are never
 * recorded.
 *
 * Covers two paths:
 *  - `/sign-in/email` (password) — newSession absent on wrong password.
 *  - `/magic-link/verify` / `/sign-in/email-otp` — newSession absent
 *    on invalid or expired token.
 */
const CREDENTIAL_FAILURE_PATHS = new Set<string>(['/sign-in/email'])
const MAGIC_LINK_FAILURE_PATHS = new Set<string>(['/magic-link/verify', '/sign-in/email-otp'])
/** The genericOAuth callback, as a Better-Auth path TEMPLATE — the concrete
 *  provider id lives in `ctx.params.providerId`, matching `inferProvider`.
 *  A failure here redirects with `?error=<code>` rather than returning a body,
 *  so the reason is read off the Location header. */
const OIDC_CALLBACK_PATH = '/oauth2/callback/:providerId'

/**
 * Pull the IdP-reported failure code out of the callback's redirect and
 * normalise it to a stable uppercase reason. Returns null when the response is
 * not a redirect or carries no error, so the caller can fall back.
 */
function oidcFailureReason(returned: unknown): string | null {
  if (!(returned instanceof Response)) return null
  const location = returned.headers.get('location')
  if (!location) return null
  try {
    const code = new URL(location, 'https://placeholder.invalid').searchParams.get('error')
    return code ? code.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : null
  } catch {
    return null
  }
}

export async function handleSignInFailureAudit(ctx: {
  path?: string
  params?: Record<string, unknown>
  body?: Record<string, unknown>
  context?: {
    newSession?: {
      user?: { id?: string; email?: string }
      session?: { token?: string }
    } | null
    /** The Response the route produced, when the hook chain exposes it. */
    returned?: unknown
  }
}): Promise<void> {
  // Only fire on sign-in paths where a failure produces no newSession.
  const path = ctx.path ?? ''
  const isCredentialPath = CREDENTIAL_FAILURE_PATHS.has(path)
  const isMagicLinkPath = MAGIC_LINK_FAILURE_PATHS.has(path)
  const isOidcCallback = path === OIDC_CALLBACK_PATH
  if (!isCredentialPath && !isMagicLinkPath && !isOidcCallback) return

  // If a session was actually created, the success audit handles it.
  const sessionCreated =
    !!ctx.context?.newSession?.user?.id && !!ctx.context?.newSession?.session?.token
  if (sessionCreated) return

  // Each path shape contributes only its actor + reason; the emit tail below is
  // shared so a change to it (a retry, a new field, the log level) lands once.
  let actor: { email: string | null; type: 'user'; authMethod: 'sso' | 'magic_link' | 'password' }
  let metadata: Record<string, unknown>

  if (isOidcCallback) {
    // No email is recorded. The callback body carries no typed credential, and
    // any address in play came from the IdP response rather than a user attempt.
    actor = { email: null, type: 'user', authMethod: 'sso' }
    metadata = {
      reason: oidcFailureReason(ctx.context?.returned) ?? 'OIDC_SIGNIN_FAILED',
      providerId: typeof ctx.params?.providerId === 'string' ? ctx.params.providerId : null,
    }
  } else {
    // Never log passwords, tokens, or other credential material — only the
    // email address + stable reason code.
    // token? is intentionally not destructured — PII guard: never read magic-link tokens
    const body = ctx.body as { email?: unknown; token?: unknown } | undefined
    actor = {
      email: typeof body?.email === 'string' ? body.email : null,
      type: 'user',
      authMethod: isMagicLinkPath ? 'magic_link' : 'password',
    }
    metadata = { reason: isMagicLinkPath ? 'INVALID_MAGIC_LINK' : 'INVALID_CREDENTIALS' }
  }

  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  try {
    await recordAuditEvent({
      event: 'auth.signin.failed',
      outcome: 'failure',
      actor,
      headers: getRequestHeaders(),
      metadata,
    })
  } catch (err) {
    // Best-effort — never let an audit failure surface to the user.
    log.error({ err }, 'sign-in failure audit emit failed')
  }
}

/**
 * Successful sign-in audit log emitter. Fires whenever Better-Auth
 * creates a `newSession` — covers password, magic-link, OTP, OAuth
 * callbacks, and SSO. The provider is inferred from `ctx.path` /
 * `ctx.params.providerId` via `inferProvider`.
 *
 * Runs late in the after-hook chain so it observes the post-revoke,
 * post-provision state — a session that was just revoked by the
 * policy cleanup won't show up here because we re-check
 * `ctx.context.newSession.session.token` after the earlier hooks
 * may have nulled it. We also re-read the principal role so the
 * audit row reflects the actor's post-provision role (e.g. a
 * brand-new SSO user shows as 'member' / 'admin', not 'user').
 */
export async function handleSignInSuccessAudit(ctx: {
  path?: string
  params?: Record<string, unknown>
  body?: Record<string, unknown>
  context?: {
    newSession?: {
      user?: { id?: string; email?: string }
      session?: { token?: string }
    } | null
  }
}): Promise<void> {
  const userId = ctx.context?.newSession?.user?.id
  const userEmail = ctx.context?.newSession?.user?.email ?? null
  const token = ctx.context?.newSession?.session?.token
  if (typeof userId !== 'string' || typeof token !== 'string') return

  const provider = inferProvider(ctx as Parameters<typeof inferProvider>[0])
  if (!provider) return

  // Look up role for the actor row. Best-effort — if the principal
  // doesn't exist yet (some sign-up flows create user first), we
  // fall back to 'user'. Role isn't load-bearing for the audit row.
  let role: string | null = null
  try {
    const { db, principal: principalTable, eq } = await import('@/lib/server/db')
    type UserId = `user_${string}`
    const principalRow = await db.query.principal.findFirst({
      where: eq(principalTable.userId, userId as UserId),
      columns: { role: true },
    })
    role = principalRow?.role ?? null
  } catch (error) {
    log.error({ err: error }, 'sign-in success audit principal lookup failed')
  }

  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  try {
    await recordAuditEvent({
      event: 'auth.signin.success',
      outcome: 'success',
      actor: {
        userId: userId as `user_${string}`,
        email: userEmail,
        role,
      },
      headers: getRequestHeaders(),
      metadata: { method: provider },
    })
  } catch (error) {
    // The session row + cookie were already written upstream. Letting
    // an audit write fail bubble up to Better-Auth would return 500 to a
    // user who is actually signed in. Log and swallow — sign-in audits
    // are observability, not policy.
    log.error({ err: error }, 'sign-in success audit emit failed')
  }
}

/**
 * First-sight new-device notification. Atomic SADD claims the
 * fingerprint; on success we fire the email + audit row in parallel
 * and refresh the SET's 90-day TTL. On failure we roll back the
 * claim so the next sign-in re-fires the alert rather than losing
 * it to a transient SMTP outage. All errors swallowed — Redis/SMTP
 * outages must not break sign-in.
 */
export async function handleNewDeviceNotification(
  ctx: {
    path?: string
    context?: {
      newSession?: {
        user?: { id?: string; email?: string }
        session?: { token?: string }
      } | null
    }
  },
  workspace: Awaited<
    ReturnType<typeof import('@/lib/server/domains/settings/settings.service').getWorkspaceSettings>
  >
): Promise<void> {
  const userId = ctx.context?.newSession?.user?.id
  const email = ctx.context?.newSession?.user?.email
  const token = ctx.context?.newSession?.session?.token
  if (typeof userId !== 'string' || typeof email !== 'string' || typeof token !== 'string') return

  const headers = getRequestHeaders()
  const userAgent = headers.get('user-agent') ?? ''
  const ip = getClientIp(headers)
  const fingerprint = computeDeviceFingerprint(userAgent, ip)

  const unseen = await isDeviceUnseen(userId, fingerprint).catch(() => false)
  if (!unseen) return

  // Email + audit are independent — fire in parallel. TTL refresh
  // runs only on full success so a failure can roll back via
  // `forgetDevice` and re-fire on the next sign-in.
  try {
    const { sendNewSignInEmail } = await import('@quackback/email')
    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    const { resolveAccountRecipient } = await import('@/lib/server/email/recipient')
    const occurredAt = new Date().toISOString()
    // Account class, and deliberately no contact-address fallback: this alert
    // discloses IP, user agent and sign-in timing, and a contact address can be
    // one an agent typed into the inbox. An account with no deliverable address
    // simply does not get the alert. The audit row and markDeviceSeen still run,
    // or every subsequent sign-in would retry a send that can never succeed.
    const to = await resolveAccountRecipient(userId as UserId)
    if (!to) {
      log.warn({ user_id: userId }, 'new-device alert skipped: no deliverable account address')
    }
    await Promise.all([
      to
        ? sendNewSignInEmail({
            to,
            workspaceName: workspace?.name,
            occurredAt,
            ipAddress: ip,
            userAgent,
            logoUrl: workspace?.brandingData?.logoUrl ?? undefined,
          })
        : Promise.resolve(),
      recordAuditEvent({
        event: 'auth.signin.new_device',
        outcome: 'success',
        actor: { userId: userId as `user_${string}`, email },
        headers,
        metadata: { ip, userAgent },
      }),
    ])
    await markDeviceSeen(userId)
  } catch (error) {
    log.error({ err: error }, 'new-device notification failed')
    await forgetDevice(userId, fingerprint)
  }
}

/**
 * Stamps `user.country` from CDN-injected request headers when a sign-in
 * mints a new session. Best-effort: a write failure must never block
 * sign-in. Only writes when the captured value differs from what's
 * already stored, so the column survives header-less requests instead
 * of being blanked on every login.
 */
export async function handleCountryCapture(ctx: {
  context?: {
    newSession?: { user?: { id?: string } } | null
  }
}): Promise<void> {
  const userId = ctx.context?.newSession?.user?.id
  if (typeof userId !== 'string') return

  const country = captureCountryFromHeaders(getRequestHeaders())
  if (!country) return

  try {
    const { db, user: userTable, eq } = await import('@/lib/server/db')
    type UserId = `user_${string}`
    const row = await db.query.user.findFirst({
      where: eq(userTable.id, userId as UserId),
      columns: { country: true },
    })
    if (row?.country === country) return
    await db
      .update(userTable)
      .set({ country })
      .where(eq(userTable.id, userId as UserId))
  } catch (error) {
    log.error({ err: error }, 'country capture failed')
  }
}

/**
 * Composed `hooks.after` middleware. Order matters:
 *
 *  1. `handleSsoCallbackAfter` — bootstrap admin promotion +
 *     lastSsoSignInAt stamp. Only fires on SSO callbacks.
 *  2. `handleAutoProvisionAfter` — for SSO callbacks, set the user's role
 *     from the CALLBACK PROVIDER's autoProvisionRole / claimMapping
 *     config, scoped to that provider's own verified domains (brand-new
 *     sign-ins default to `role='user'`).
 *  3. `handleCallbackPolicyCleanup` — revoke sessions that violate
 *     per-domain SSO enforcement or a disabled per-method toggle. SSO is
 *     allowed for every role, so verified-domain users pass this step; it
 *     gates the non-SSO providers.
 *  4. `applyClaimAttributesAfter` — copy mapped IdP claims into person
 *     attributes. After cleanup so a revoked session writes nothing;
 *     wrapped in try/catch so a DB error never blocks sign-in.
 *  5. `handleSignInSuccessAudit` — emits `auth.signin.success` if a
 *     session still exists at this point (i.e. wasn't revoked by
 *     prior steps). Runs after the gates so it only records sign-ins
 *     that actually stuck.
 *  6. `handleNewDeviceNotification` — sends a "new device" email +
 *     records an audit row when the user's UA + /24-IP combination
 *     hasn't been seen for them within the last 90 days.
 */
export const hooksAfter = createAuthMiddleware(async (ctx) => {
  if (process.env.AUTH_HOOKS_DEBUG === '1') {
    const provider = inferProvider(ctx as Parameters<typeof inferProvider>[0])
    log.debug({ path: ctx.path, provider: provider ?? null }, 'after-hook')
  }

  // The provider registry is only consulted by the OAuth-callback after-hooks
  // (bootstrap promotion, auto-provision, policy cleanup, claim attributes).
  // Skip the DB read on password / magic-link success paths — those callbacks
  // early-return before touching `providers` / `registeredOidcIds`, so the
  // empty defaults are safe.
  let providers: Awaited<
    ReturnType<
      typeof import('@/lib/server/domains/settings/identity-providers.service').listIdentityProviders
    >
  > = []
  let registeredOidcIds = new Set<string>()
  if (SESSION_CREATING_CALLBACK_PATHS.has(ctx.path ?? '')) {
    const { listIdentityProviders } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const { getRegisteredOidcProviderIds } = await import('./registered-providers')
    providers = await listIdentityProviders()
    registeredOidcIds = await getRegisteredOidcProviderIds(providers)
  }

  await handleSsoCallbackAfter(
    ctx as Parameters<typeof handleSsoCallbackAfter>[0],
    registeredOidcIds,
    providers
  )

  // One settings fetch shared across all helpers below so we don't
  // make 2-3 sequential cache round-trips per sign-in.
  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const workspace = await getWorkspaceSettings()

  // One claim read per callback. The stash is take-once, so role
  // provisioning and attribute writes must share the result rather than
  // each calling `takeResolvedClaims`.
  let claimsPromise: Promise<ClaimRead> | undefined
  const callbackUserId = ctx.context?.newSession?.user?.id
  const callbackProviderId = ctx.params?.providerId
  const readClaims =
    ctx.path === '/oauth2/callback/:providerId' &&
    typeof callbackUserId === 'string' &&
    typeof callbackProviderId === 'string'
      ? () => {
          if (!claimsPromise) {
            claimsPromise = readSsoClaimsWithProvenance(
              callbackUserId as `user_${string}`,
              callbackProviderId
            )
          }
          return claimsPromise
        }
      : undefined

  // Before auto-provision: this one only PEEKS the resolved-claims stash, and
  // role provisioning (below) TAKES it — so the avatar has to look first.
  await handleAvatarBackfillAfter(
    ctx as Parameters<typeof handleAvatarBackfillAfter>[0],
    registeredOidcIds,
    providers
  )
  await handleAutoProvisionAfter(
    ctx as Parameters<typeof handleAutoProvisionAfter>[0],
    providers,
    registeredOidcIds,
    readClaims
  )
  await handleCallbackPolicyCleanup(
    ctx as Parameters<typeof handleCallbackPolicyCleanup>[0],
    workspace,
    providers,
    registeredOidcIds
  )
  try {
    await applyClaimAttributesAfter(
      ctx as Parameters<typeof applyClaimAttributesAfter>[0],
      providers,
      registeredOidcIds,
      readClaims
    )
  } catch (err) {
    log.error(
      { err, user_id: callbackUserId, provider_id: callbackProviderId },
      'claim attribute write failed'
    )
  }
  // SOC2 trail for user-initiated 2FA lifecycle (`two_factor.enabled`
  // and `two_factor.disabled`). Independent of sign-in success audit;
  // both can fire on the same request only for the verify-totp
  // enrollment path (which itself does not constitute a sign-in).
  await handleTwoFactorLifecycleAudit(ctx as Parameters<typeof handleTwoFactorLifecycleAudit>[0])
  await handleSignInFailureAudit(ctx as Parameters<typeof handleSignInFailureAudit>[0])
  await handleSignInSuccessAudit(ctx as Parameters<typeof handleSignInSuccessAudit>[0])
  // Geo-IP country from CDN headers; written best-effort, never blocks.
  await handleCountryCapture(ctx as Parameters<typeof handleCountryCapture>[0])
  // Fires only when a new device fingerprint (UA + /24) for this user
  // is observed; default-on but workspace can opt out.
  await handleNewDeviceNotification(
    ctx as Parameters<typeof handleNewDeviceNotification>[0],
    workspace
  )
})
