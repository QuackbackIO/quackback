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
 *     cookie, and redirect. Also hosts the workspace Require-2FA gate
 *     for credential sign-in success (post-auth, to avoid leaking
 *     account state to anonymous probes).
 */

import { createAuthMiddleware } from 'better-auth/api'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import {
  checkCredentialSignInRateLimit,
  checkMagicLinkSendRateLimit,
  type SignInRateLimiter,
} from './signin-rate-limit'
import {
  computeDeviceFingerprint,
  forgetDevice,
  isDeviceUnseen,
  markDeviceSeen,
} from './signin-device-tracker'

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
 * Path templates verified against installed Better-Auth 1.6.5 source:
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
    console.log(`[auth-hooks.before] path=${ctx.path} provider=${provider}`)
  }

  if (NO_EMAIL_BEFORE_PATHS.has(ctx.path ?? '')) return

  const body = ctx.body as { email?: unknown } | undefined
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
  if (!email) return

  // Rate-limit before any DB load. Generic redirect on block so the
  // response doesn't leak which dimension hit the cap. Sequential
  // with the tenant fetch so a DB hiccup can't mask a 429 with a 500.
  const headers = getRequestHeaders()
  const ip = getClientIp(headers)
  const rateLimiter = selectSignInRateLimiter(provider)
  const rateLimitResult: Awaited<ReturnType<SignInRateLimiter>> = rateLimiter
    ? await rateLimiter(ip, email).catch((error) => {
        console.error('[handleSignInPreCheck] rate-limit threw; failing open:', error)
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
      console.error('[handleSignInPreCheck] audit emit failed (rate-limit):', auditErr)
    }
    throw ctx.redirect('/admin/login?error=rate_limited')
  }

  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
  const tenant = await getTenantSettings()

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
  const role = (principalRow?.role ?? 'user') as 'admin' | 'member' | 'user'

  // Pre-compute "is SSO actually viable right now?" so `isHardBound`
  // can fail open on tier-downgrade / missing-secret states (else team
  // admins lock themselves out the moment an upstream condition flips).
  const { isSsoActuallyRegistered } = await import('./sso-secret')
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const ssoRegistered = await isSsoActuallyRegistered(
    tenant?.authConfig?.ssoOidc,
    await getTierLimits()
  )

  // Hard-binding: refuses password / magic-link / email-OTP for
  // emails at a verified-domain row marked enforced (per-domain).
  // The verified-domain branch fires before user lookup matters —
  // inbox control at the verified domain shouldn't bypass the IdP's
  // attestations even for brand-new sign-ups.
  if (
    isHardBound(provider, email, role, tenant?.authConfig, tenant?.verifiedDomains, ssoRegistered)
  ) {
    throw ctx.redirect('/admin/login?error=verified_domain_requires_sso')
  }

  if (!principalRow) return

  const result = await isAuthMethodAllowed(provider, role, tenant)
  if (!result.allowed) {
    const isTeamRole = role === 'admin' || role === 'member'
    const target = isTeamRole ? '/admin/login' : '/auth/login'
    throw ctx.redirect(`${target}?error=${result.error ?? 'auth_method_blocked'}`)
  }

  // NB: the workspace-wide Require-2FA gate used to live here, but
  // gating before password verification leaks account state — an
  // attacker can probe the redirect to enumerate team-role users
  // without 2FA. The check now runs in `handleCredentialPostSignInGate`
  // below (Layer C), after Better-Auth has verified the password.
}

export const hooksBefore = createAuthMiddleware(async (ctx) => {
  await handleSignInPreCheck(ctx as Parameters<typeof handleSignInPreCheck>[0])
})

/**
 * SSO callback post-processing — runs only for the SSO provider id.
 *
 * Two responsibilities:
 *
 * 1. **Bootstrap-only admin promotion.** Replaces the buggy
 *    `databaseHooks.account.create.after` block in auth/index.ts that
 *    upgraded *every* SSO sign-in to admin. The new behavior: only the
 *    first SSO sign-in into a workspace with no existing admin claims
 *    admin. Wraps in a transaction with `pg_advisory_xact_lock` so
 *    concurrent first-SSO sign-ins don't race the existing-admin
 *    check. Recovery-scoped — a healthy workspace post-onboarding
 *    always has an admin so this is a no-op.
 *
 * 2. **`lastSsoSignInAt` write.** Read by `setVerifiedDomainEnforcedFn`'s
 *    bootstrap guard to refuse turning per-domain enforcement on
 *    without a recent SSO sign-in. Written here on every successful
 *    SSO callback (newSession exists). Link callbacks have no
 *    newSession and are correctly skipped — explicit account-link
 *    isn't an SSO sign-in.
 */
export async function handleSsoCallbackAfter(ctx: {
  path?: string
  params?: Record<string, unknown>
  context?: {
    newSession?: { user?: { id?: string }; session?: { token?: string } } | null
  }
}): Promise<void> {
  if (ctx.path !== '/oauth2/callback/:providerId') return
  if (ctx.params?.providerId !== 'sso') return
  const userId = ctx.context?.newSession?.user?.id
  if (typeof userId !== 'string' || userId.length === 0) return

  const { db, principal: principalTable, and, eq, sql } = await import('@/lib/server/db')
  // Cast through the typeid-branded type so Drizzle's eq() narrows.
  type UserId = `user_${string}`
  const userIdTyped = userId as UserId

  await db.transaction(async (tx) => {
    // Workspace-scoped advisory lock so concurrent first-SSO sign-ins
    // serialise. Hash key is stable across pods. Released on commit.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('quackback:sso_bootstrap'))`)

    // Bootstrap admin promotion: only fires when no human admin
    // exists. A healthy workspace post-/admin/setup always has one,
    // so this branch is recovery-scoped (deleted admin, skipped
    // onboarding, config-file provisioning before any admin
    // existed). Filter to type='user' so a service-principal admin
    // (e.g. a config-file-provisioned API key) doesn't block the
    // first real user from self-promoting.
    const existingAdmin = await tx.query.principal.findFirst({
      where: and(eq(principalTable.role, 'admin'), eq(principalTable.type, 'user')),
      columns: { id: true },
    })
    if (!existingAdmin) {
      await tx
        .update(principalTable)
        .set({ role: 'admin' })
        .where(eq(principalTable.userId, userIdTyped))
      console.log(`[auth-hooks.after] SSO bootstrap promotion: userId=${userId}`)
    }

    // Stamp lastSsoSignInAt for the bootstrap guard's window check.
    // Run in the same tx so the lock window covers both writes; the
    // promotion path needs the timestamp first so the same admin can
    // immediately enable enforcement.
    await tx
      .update(principalTable)
      .set({ lastSsoSignInAt: new Date() })
      .where(eq(principalTable.userId, userIdTyped))
  })
}

/**
 * Auto-provision verified-domain users to a configurable role on first
 * SSO sign-in (defaults to `member`).
 *
 * Fires only on the SSO callback (`/oauth2/callback/sso`). The IdP's
 * assertion of email + identity is the trust source; magic-link to a
 * verified-domain email is hard-bound in `hooksBefore` so it never
 * reaches this path, and password/other-OAuth callbacks are likewise
 * blocked. Without the IdP attestation, mere inbox control isn't
 * enough to claim team membership.
 *
 * Invariants:
 *  - Only upgrades from `role='user'`; `admin` and `member` are left
 *    alone. The target role is `authConfig.ssoOidc.autoProvisionRole`
 *    (default `'member'`), and the special value `'user'` disables
 *    promotion entirely.
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
  /** Settings already fetched by the parent middleware. */
  tenant: Awaited<
    ReturnType<typeof import('@/lib/server/domains/settings/settings.service').getTenantSettings>
  >
): Promise<void> {
  if (ctx.path !== '/oauth2/callback/:providerId') return
  if (ctx.params?.providerId !== 'sso') return

  const userId = ctx.context?.newSession?.user?.id
  const email = ctx.context?.newSession?.user?.email
  if (typeof userId !== 'string' || typeof email !== 'string') return

  const sso = tenant?.authConfig?.ssoOidc
  if (!sso?.autoCreateUsers) return

  const { isEmailAtVerifiedDomain } = await import('./auth-restrictions')
  if (!isEmailAtVerifiedDomain(email, tenant?.verifiedDomains)) return

  const { db, principal: principalTable, eq } = await import('@/lib/server/db')
  type UserId = `user_${string}`
  const userIdTyped = userId as UserId

  const p = await db.query.principal.findFirst({
    where: eq(principalTable.userId, userIdTyped),
    columns: { role: true },
  })

  // Resolve target role: attribute mapping takes precedence over the
  // legacy autoProvisionRole field. When mapping returns null, fall
  // back to the legacy field.
  let targetRole: 'admin' | 'member' | 'user'
  if (sso.attributeMapping) {
    const claims = await readSsoClaims(userIdTyped)
    const { resolveSsoRole } = await import('./resolve-sso-role')
    targetRole = resolveSsoRole(claims, sso.attributeMapping) ?? sso.autoProvisionRole ?? 'member'
  } else {
    targetRole = sso.autoProvisionRole ?? 'member'
  }

  // Sync mode: re-apply on every sign-in, including for existing
  // admin/member users. Without sync, JIT semantics — only first
  // sign-in (role='user') gets touched.
  const syncOnEverySignIn = sso.attributeMapping?.syncOnEverySignIn === true
  if (!syncOnEverySignIn && p?.role !== 'user') return

  // 'user' as the target is the explicit no-promote choice — only
  // demote an existing team-role user to 'user' under sync mode.
  if (targetRole === 'user' && !syncOnEverySignIn) return

  if (p?.role === targetRole) return // no-op, save the update

  await db
    .update(principalTable)
    .set({ role: targetRole })
    .where(eq(principalTable.userId, userIdTyped))

  if (p?.role && p.role !== targetRole) {
    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    await recordAuditEvent({
      event: 'user.role.changed',
      outcome: 'success',
      actor: { email: email ?? null }, // SSO callback — no authenticated admin actor
      target: { type: 'user', id: userIdTyped },
      before: { role: p.role },
      after: { role: targetRole },
      metadata: { source: sso.attributeMapping ? 'attribute_mapping' : 'auto_provision' },
    })
  }

  console.log(
    `[auth-hooks.after] auto-provisioned verified-domain user as ${targetRole} via sso: userId=${userId}`
  )
}

/**
 * Read the latest stored ID-token claims for a user's SSO account.
 * Returns an empty object when no token is stored or the token is
 * malformed — caller should fall back to the legacy auto-provision
 * field in that case.
 */
async function readSsoClaims(userId: `user_${string}`): Promise<Record<string, unknown>> {
  const { db, account, and, eq } = await import('@/lib/server/db')
  const row = await db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, 'sso')),
    columns: { idToken: true },
  })
  if (!row?.idToken) return {}

  const parts = row.idToken.split('.')
  if (parts.length !== 3) return {}
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8')
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return {}
  }
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
 * Drop a freshly-created session: delete the row, clear the cookie.
 * Both the hard-binding and role-policy branches need this.
 */
async function revokeSession(ctx: SessionCtx, token: string): Promise<void> {
  const { db, session: sessionTable, eq } = await import('@/lib/server/db')
  await db.delete(sessionTable).where(eq(sessionTable.token, token))
  const { deleteSessionCookie } = await import('better-auth/cookies')
  deleteSessionCookie(ctx)
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
  tenant: Awaited<
    ReturnType<typeof import('@/lib/server/domains/settings/settings.service').getTenantSettings>
  >
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

  const { isHardBound, isAuthMethodAllowed } = await import('./auth-restrictions')
  const verifiedDomains = tenant?.verifiedDomains

  // Look up the principal once — both the role-aware redirect (for the
  // hard-binding branch) and the role-based policy check (below) need it.
  const principalRow = await db.query.principal.findFirst({
    where: eq(principalTable.userId, userId as UserId),
    columns: { role: true },
  })
  const role = (principalRow?.role ?? 'user') as 'admin' | 'member' | 'user'
  const isTeamRole = role === 'admin' || role === 'member'
  const blockedRedirect = (errorCode: string) =>
    ctx.redirect(`${isTeamRole ? '/admin/login' : '/auth/login'}?error=${errorCode}`)

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

  // Pre-compute viability so `isHardBound` fails open on runtime
  // unavailability (tier downgrade, secret missing). See the
  // `isHardBound` docstring for the self-lockout rationale.
  const { isSsoActuallyRegistered } = await import('./sso-secret')
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const ssoRegistered = await isSsoActuallyRegistered(
    tenant?.authConfig?.ssoOidc,
    await getTierLimits()
  )

  // Hard-binding for non-SSO callbacks: per-domain enforcement only
  // (verified-domain row with enforced=true). `isHardBound` treats
  // every provider except `sso` as hard-bindable, so this is the gate
  // that actually blocks social / generic-OAuth sign-ins for emails at
  // an enforced verified domain — Layer B can't (no email pre-session
  // on callback paths).
  if (
    provider !== 'sso' &&
    typeof userEmail === 'string' &&
    isHardBound(provider, userEmail, role, tenant?.authConfig, verifiedDomains, ssoRegistered)
  ) {
    await revokeSession(ctx as SessionCtx, token)
    await wipeBrandNewShellsIfFresh()
    throw blockedRedirect('verified_domain_requires_sso')
  }

  if (!principalRow) return

  const result = await isAuthMethodAllowed(provider, role, tenant)
  if (result.allowed) return

  await revokeSession(ctx as SessionCtx, token)
  await wipeBrandNewShellsIfFresh()
  throw blockedRedirect(result.error ?? 'auth_method_blocked')
}

/**
 * Workspace `Require 2FA` gate for password sign-in.
 *
 * Fires after Better-Auth has verified the password and created the
 * session (matches the same path set as Better-Auth's twoFactor plugin:
 * `/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`). When
 * the workspace has 2FA required and the just-authenticated user is a
 * team-role principal with no enrolled 2FA, we revoke the brand-new
 * session and redirect to the setup-required landing page.
 *
 * Why post-auth: pre-auth gating leaks account state — an attacker can
 * try `email=alice@acme.com` with any password and observe the redirect
 * to `/auth/two-factor-setup-required` to confirm Alice exists, is a
 * team member, and has no 2FA. Post-auth verification closes that
 * oracle: the only path that reaches the gate is a real password
 * success, so the redirect is no more informative than any other
 * post-sign-in landing page.
 *
 * Better-Auth's own twoFactor plugin handles users who DO have 2FA
 * enrolled — its hook matches the same paths, sees `twoFactorEnabled`,
 * deletes the session, and emits `twoFactorRedirect: true` for the
 * client to navigate to the challenge page. Our hook is the
 * complementary case: enrollment missing but required.
 */
const CREDENTIAL_SIGN_IN_PATHS = new Set<string>([
  '/sign-in/email',
  '/sign-in/username',
  '/sign-in/phone-number',
])

export async function handleCredentialPostSignInGate(
  ctx: {
    path?: string
    context?: {
      newSession?: {
        user?: { id?: string }
        session?: { token?: string }
      } | null
    }
    redirect: (url: string) => Error
  },
  tenant: Awaited<
    ReturnType<typeof import('@/lib/server/domains/settings/settings.service').getTenantSettings>
  >
): Promise<void> {
  if (!CREDENTIAL_SIGN_IN_PATHS.has(ctx.path ?? '')) return

  const workspaceRequired = tenant?.authConfig?.twoFactor?.required === true
  if (!workspaceRequired) return

  const userId = ctx.context?.newSession?.user?.id
  const token = ctx.context?.newSession?.session?.token
  // No newSession means Better-Auth's twoFactor plugin already
  // intercepted (user has 2FA enrolled — challenge handoff). Bail.
  if (typeof userId !== 'string' || typeof token !== 'string') return

  const { db, user: userTable, principal: principalTable, eq } = await import('@/lib/server/db')
  type UserId = `user_${string}`
  const userIdTyped = userId as UserId

  const [userRow, principalRow] = await Promise.all([
    db.query.user.findFirst({
      where: eq(userTable.id, userIdTyped),
      columns: { twoFactorEnabled: true },
    }),
    db.query.principal.findFirst({
      where: eq(principalTable.userId, userIdTyped),
      columns: { role: true },
    }),
  ])
  if (!principalRow) return

  const { shouldRequire2FA } = await import('./two-factor-policy')
  if (
    !shouldRequire2FA({
      role: principalRow.role as 'admin' | 'member' | 'user',
      userHas2FA: userRow?.twoFactorEnabled === true,
      workspaceRequired,
    })
  ) {
    return
  }

  // Revoke the just-created session row BEFORE throwing the redirect —
  // otherwise the user is signed in despite the redirect. revokeSession
  // deletes the row and clears the cookie via Better-Auth's helper.
  await revokeSession(ctx as SessionCtx, token)
  throw ctx.redirect('/auth/two-factor-setup-required')
}

/**
 * Workspace `Require 2FA` gate for **magic-link** sign-in.
 *
 * Better-Auth's twoFactor plugin only intercepts password paths
 * (`/sign-in/email`, etc.) — magic-link verification creates a session
 * directly without offering a TOTP challenge. Without this gate, a
 * team-role user with 2FA enrolled could sign in via magic-link and
 * bypass the second factor entirely (anyone with inbox access wins,
 * which defeats the purpose of requiring 2FA).
 *
 * Two outcomes for team-role users when the workspace requires 2FA:
 *   - **No 2FA enrolled** — same as the credential gate: revoke the
 *     just-created session and redirect to `/auth/two-factor-setup-required`.
 *   - **2FA enrolled** — refuse and redirect to `/admin/login?error=
 *     use_password_for_2fa`. The user must complete the password+TOTP
 *     flow where Better-Auth's plugin handles the challenge. Recovery
 *     codes remain the documented break-glass for lost authenticators.
 *
 * Portal users (`role='user'`) are never gated — workspace 2FA is
 * team-only policy.
 *
 * Path set: only the verify endpoints (which actually create a
 * session). The send endpoints (`/sign-in/magic-link`,
 * `/email-otp/send-verification-otp`) don't create a session, so
 * `newSession` is empty and the gate naturally short-circuits.
 */
const MAGIC_LINK_VERIFY_PATHS = new Set<string>(['/magic-link/verify', '/sign-in/email-otp'])

export async function handleMagicLinkPostSignInGate(
  ctx: {
    path?: string
    context?: {
      newSession?: {
        user?: { id?: string }
        session?: { token?: string }
      } | null
    }
    redirect: (url: string) => Error
  },
  tenant: Awaited<
    ReturnType<typeof import('@/lib/server/domains/settings/settings.service').getTenantSettings>
  >
): Promise<void> {
  if (!MAGIC_LINK_VERIFY_PATHS.has(ctx.path ?? '')) return

  const workspaceRequired = tenant?.authConfig?.twoFactor?.required === true
  if (!workspaceRequired) return

  const userId = ctx.context?.newSession?.user?.id
  const token = ctx.context?.newSession?.session?.token
  if (typeof userId !== 'string' || typeof token !== 'string') return

  const { db, user: userTable, principal: principalTable, eq } = await import('@/lib/server/db')
  type UserId = `user_${string}`
  const userIdTyped = userId as UserId

  const [userRow, principalRow] = await Promise.all([
    db.query.user.findFirst({
      where: eq(userTable.id, userIdTyped),
      columns: { twoFactorEnabled: true },
    }),
    db.query.principal.findFirst({
      where: eq(principalTable.userId, userIdTyped),
      columns: { role: true },
    }),
  ])
  if (!principalRow) return

  const { evaluateMagicLinkTwoFactor } = await import('./two-factor-policy')
  const outcome = evaluateMagicLinkTwoFactor({
    role: principalRow.role as 'admin' | 'member' | 'user',
    userHas2FA: userRow?.twoFactorEnabled === true,
    workspaceRequired,
  })
  if (outcome === 'allow') return

  // Both blocking outcomes revoke the just-created session; the
  // redirect target differs based on whether the user can enroll
  // (setup) or must use the password flow (use-password).
  await revokeSession(ctx as SessionCtx, token)
  throw ctx.redirect(
    outcome === 'setup-required'
      ? '/auth/two-factor-setup-required'
      : '/admin/login?error=use_password_for_2fa'
  )
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
    console.error('[auth-hooks.after] handleTwoFactorLifecycleAudit: audit emit failed:', error)
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
    console.error('[auth-hooks.after] handleSignInSuccessAudit: principal lookup failed:', error)
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
    console.error('[auth-hooks.after] handleSignInSuccessAudit: audit emit failed:', error)
  }
}

/**
 * First-sight new-device notification. Atomic SADD claims the
 * fingerprint; on success we fire the email + audit row in parallel
 * and refresh the SET's 90-day TTL. On failure we roll back the
 * claim so the next sign-in re-fires the alert rather than losing
 * it to a transient SMTP outage. Workspace-configurable via
 * `authConfig.security.notifyOnNewSignIn` (default on). All errors
 * swallowed — Redis/SMTP outages must not break sign-in.
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
  tenant: Awaited<
    ReturnType<typeof import('@/lib/server/domains/settings/settings.service').getTenantSettings>
  >
): Promise<void> {
  if (tenant?.authConfig?.security?.notifyOnNewSignIn === false) return

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
    const occurredAt = new Date().toISOString()
    await Promise.all([
      sendNewSignInEmail({
        to: email,
        workspaceName: tenant?.name,
        occurredAt,
        ipAddress: ip,
        userAgent,
        logoUrl: tenant?.brandingData?.logoUrl ?? undefined,
      }),
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
    console.error('[auth-hooks.after] handleNewDeviceNotification: failed:', error)
    await forgetDevice(userId, fingerprint)
  }
}

/**
 * Composed `hooks.after` middleware. Order matters:
 *
 *  1. `handleSsoCallbackAfter` — bootstrap admin promotion +
 *     lastSsoSignInAt stamp. Only fires on SSO callbacks.
 *  2. `handleAutoProvisionAfter` — promote brand-new verified-domain
 *     sign-ins from `role='user'` (default) up to `member`/`admin`
 *     per the workspace's autoProvisionRole / attributeMapping
 *     config. MUST run before the policy cleanup, otherwise the
 *     cleanup sees role='user' and runs `checkPortalAuthMethod('sso')`,
 *     which blocks the sign-in because `portalConfig.oauth.sso`
 *     isn't set (SSO is configured on the team side, not the portal).
 *  3. `handleCallbackPolicyCleanup` — revoke sessions that violate
 *     per-domain enforcement or workspace policy. Now sees the
 *     post-provision role, so SSO callbacks for verified-domain
 *     users are correctly classified as team and allowed through.
 *  4. `handleCredentialPostSignInGate` — Require-2FA gate for the
 *     password path.
 *  5. `handleMagicLinkPostSignInGate` — Require-2FA gate for magic-
 *     link / email-OTP verify paths. Better-Auth's twoFactor plugin
 *     only covers password paths, so this is our own enforcement.
 *  6. `handleSignInSuccessAudit` — emits `auth.signin.success` if a
 *     session still exists at this point (i.e. wasn't revoked by
 *     prior steps). Runs after the gates so it only records sign-ins
 *     that actually stuck.
 *  7. `handleNewDeviceNotification` — sends a "new device" email +
 *     records an audit row when the user's UA + /24-IP combination
 *     hasn't been seen for them within the last 90 days. Workspace-
 *     configurable via `authConfig.security.notifyOnNewSignIn`.
 */
export const hooksAfter = createAuthMiddleware(async (ctx) => {
  if (process.env.AUTH_HOOKS_DEBUG === '1') {
    const provider = inferProvider(ctx as Parameters<typeof inferProvider>[0])
    console.log(`[auth-hooks.after] path=${ctx.path} provider=${provider ?? 'n/a'}`)
  }
  await handleSsoCallbackAfter(ctx as Parameters<typeof handleSsoCallbackAfter>[0])

  // One settings fetch shared across all helpers below so we don't
  // make 2-3 sequential cache round-trips per sign-in.
  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
  const tenant = await getTenantSettings()

  await handleAutoProvisionAfter(ctx as Parameters<typeof handleAutoProvisionAfter>[0], tenant)
  await handleCallbackPolicyCleanup(
    ctx as Parameters<typeof handleCallbackPolicyCleanup>[0],
    tenant
  )
  // Workspace Require-2FA gate for password sign-in success — closes
  // the pre-auth enumeration oracle that used to live in hooksBefore.
  await handleCredentialPostSignInGate(
    ctx as Parameters<typeof handleCredentialPostSignInGate>[0],
    tenant
  )
  // Workspace Require-2FA gate for magic-link / email-OTP verify
  // success — Better-Auth's twoFactor plugin only covers password
  // paths, so without this gate a team user with 2FA enrolled could
  // sign in via magic-link and skip the second factor.
  await handleMagicLinkPostSignInGate(
    ctx as Parameters<typeof handleMagicLinkPostSignInGate>[0],
    tenant
  )
  // SOC2 trail for user-initiated 2FA lifecycle (`two_factor.enabled`
  // and `two_factor.disabled`). Independent of sign-in success audit;
  // both can fire on the same request only for the verify-totp
  // enrollment path (which itself does not constitute a sign-in).
  await handleTwoFactorLifecycleAudit(ctx as Parameters<typeof handleTwoFactorLifecycleAudit>[0])
  await handleSignInSuccessAudit(ctx as Parameters<typeof handleSignInSuccessAudit>[0])
  // Fires only when a new device fingerprint (UA + /24) for this user
  // is observed; default-on but workspace can opt out.
  await handleNewDeviceNotification(
    ctx as Parameters<typeof handleNewDeviceNotification>[0],
    tenant
  )
})
