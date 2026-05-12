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
export const hooksBefore = createAuthMiddleware(async (ctx) => {
  const provider = inferProvider(ctx as Parameters<typeof inferProvider>[0])
  if (!provider) return

  if (process.env.AUTH_HOOKS_DEBUG === '1') {
    console.log(`[auth-hooks.before] path=${ctx.path} provider=${provider}`)
  }

  if (NO_EMAIL_BEFORE_PATHS.has(ctx.path ?? '')) return

  const body = ctx.body as { email?: unknown } | undefined
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
  if (!email) return

  // One settings fetch per request, threaded through every helper that
  // would otherwise re-hit the cache.
  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
  const tenant = await getTenantSettings()

  const { isHardBoundByVerifiedDomain, isAuthMethodAllowed } = await import('./auth-restrictions')

  // Hard-binding: when the matching verified-domain row has
  // `enforced=true`, emails at that domain are rejected for password /
  // magic-link / email-OTP before any user lookup — inbox control at
  // the verified domain shouldn't bypass the IdP's role/MFA attestations.
  // Without per-row enforcement, verification is routing-only and this
  // predicate returns false.
  if (isHardBoundByVerifiedDomain(provider, email, tenant?.verifiedDomains)) {
    throw ctx.redirect('/admin/login?error=verified_domain_requires_sso')
  }

  const { db, user: userTable, principal: principalTable, eq } = await import('@/lib/server/db')
  type UserId = `user_${string}`
  const userRow = await db.query.user.findFirst({
    where: eq(userTable.email, email),
    columns: { id: true },
  })
  if (!userRow) return

  const principalRow = await db.query.principal.findFirst({
    where: eq(principalTable.userId, userRow.id as UserId),
    columns: { role: true },
  })
  if (!principalRow) return

  const result = await isAuthMethodAllowed(
    provider,
    principalRow.role as 'admin' | 'member' | 'user',
    tenant
  )
  if (!result.allowed) {
    const isTeamRole = principalRow.role === 'admin' || principalRow.role === 'member'
    const target = isTeamRole ? '/admin/login' : '/auth/login'
    throw ctx.redirect(`${target}?error=${result.error ?? 'auth_method_blocked'}`)
  }

  // NB: the workspace-wide Require-2FA gate used to live here, but
  // gating before password verification leaks account state — an
  // attacker can probe the redirect to enumerate team-role users
  // without 2FA. The check now runs in `handleCredentialPostSignInGate`
  // below (Layer C), after Better-Auth has verified the password.
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
async function handleSsoCallbackAfter(ctx: {
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

async function handleCallbackPolicyCleanup(
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

  const { findVerifiedDomainForEmail, isAuthMethodAllowed } = await import('./auth-restrictions')
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

  // Hard-binding: a non-SSO callback gets revoked when the IdP-asserted
  // email matches a verified-domain row whose `enforced` flag is on.
  // Without per-row enforcement, verification is routing-only and other
  // methods stay open. Trust the email here, not the just-created
  // principal's role — a brand-new verified-domain sign-up would
  // otherwise slip through.
  if (provider !== 'sso' && typeof userEmail === 'string') {
    const enforcedRow = findVerifiedDomainForEmail(userEmail, verifiedDomains)
    if (enforcedRow?.enforced === true) {
      await revokeSession(ctx as SessionCtx, token)

      // Wipe user/account/principal for brand-new users so blocked
      // first-time sign-ups don't leave shells behind. Existing users
      // (pre-dating verification) keep their rows.
      const userRow = await db.query.user.findFirst({
        where: eq(userTable.id, userId as UserId),
        columns: { createdAt: true },
      })
      const justCreated = userRow?.createdAt && Date.now() - userRow.createdAt.getTime() < 60_000
      if (justCreated) {
        await db.delete(accountTable).where(eq(accountTable.userId, userId as UserId))
        await db.delete(principalTable).where(eq(principalTable.userId, userId as UserId))
        await db.delete(userTable).where(eq(userTable.id, userId as UserId))
      }

      throw blockedRedirect('verified_domain_requires_sso')
    }
  }

  if (!principalRow) return

  const result = await isAuthMethodAllowed(provider, role, tenant)
  if (result.allowed) return

  await revokeSession(ctx as SessionCtx, token)
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
 * Composed `hooks.after` middleware. Order matters: bootstrap admin
 * promotion + lastSsoSignInAt run before policy cleanup, so a
 * legitimate first-SSO sign-in still claims admin even if a stale
 * `enforced=true` would otherwise revoke it (the policy allows SSO
 * under enforcement, so the cleanup is a no-op for that path).
 */
export const hooksAfter = createAuthMiddleware(async (ctx) => {
  if (process.env.AUTH_HOOKS_DEBUG === '1') {
    const provider = inferProvider(ctx as Parameters<typeof inferProvider>[0])
    console.log(`[auth-hooks.after] path=${ctx.path} provider=${provider ?? 'n/a'}`)
  }
  await handleSsoCallbackAfter(ctx as Parameters<typeof handleSsoCallbackAfter>[0])

  // One settings fetch shared across the two policy helpers below so
  // we don't make 2-3 sequential cache round-trips per sign-in.
  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
  const tenant = await getTenantSettings()

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
  // Auto-provision runs last so it observes post-bootstrap and post-
  // cleanup principal state. The role==='user' guard prevents it from
  // touching admins promoted by handleSsoCallbackAfter.
  await handleAutoProvisionAfter(ctx as Parameters<typeof handleAutoProvisionAfter>[0], tenant)
})
