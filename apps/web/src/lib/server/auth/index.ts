import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  anonymous,
  emailOTP,
  oneTimeToken,
  magicLink,
  jwt,
  genericOAuth,
  bearer,
  twoFactor,
} from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { generateId } from '@quackback/ids'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'auth-config' })

// Plugin callbacks (magicLink, emailOTP) stash tokens here instead of
// emailing — callers that own the email template (invitations,
// combined sign-in email) drain the stash and email themselves.
const STASH_TTL_MS = 30_000

function makeStash<T>() {
  const m = new Map<string, { value: T; ts: number }>()
  return {
    set(key: string, value: T) {
      const k = key.toLowerCase()
      m.set(k, { value, ts: Date.now() })
      setTimeout(() => {
        const s = m.get(k)
        if (s && Date.now() - s.ts >= STASH_TTL_MS) m.delete(k)
      }, STASH_TTL_MS)
    },
    take(key: string): T | undefined {
      const k = key.toLowerCase()
      const s = m.get(k)
      if (!s) return undefined
      m.delete(k)
      return s.value
    },
  }
}

const magicLinkStash = makeStash<string>()
const otpStash = makeStash<string>()

export const storeMagicLinkToken = (email: string, token: string) =>
  magicLinkStash.set(email, token)
export const getMagicLinkToken = (email: string) => magicLinkStash.take(email)
export const storeOTP = (email: string, otp: string) => otpStash.set(email, otp)
export const getOTP = (email: string) => otpStash.take(email)

// Lazy-initialized auth instance
// This prevents client bundling of database code
type AuthInstance = Awaited<ReturnType<typeof createAuth>>['instance']
let _auth: AuthInstance | null = null
// Cross-pod invalidation: the version of `settings.auth_config_version`
// at the time the cached _auth was built. Compared per-request against
// the current value (via the existing settings cache, no extra DB
// round-trip). Mismatch → resetAuth(), other pods' writes propagate.
let _authConfigVersion: number | null = null

async function createAuth() {
  // Dynamic imports to prevent client bundling
  const {
    db,
    user: userTable,
    session: sessionTable,
    account: accountTable,
    verification: verificationTable,
    oneTimeToken: oneTimeTokenTable,
    settings: settingsTable,
    principal: principalTable,
    invitation: invitationTable,
    jwks: jwksTable,
    oauthClient: oauthClientTable,
    oauthAccessToken: oauthAccessTokenTable,
    oauthRefreshToken: oauthRefreshTokenTable,
    oauthConsent: oauthConsentTable,
    twoFactor: twoFactorTable,
    eq,
  } = await import('@/lib/server/db')
  const { sendPasswordResetEmail, isEmailConfigured } = await import('@quackback/email')
  const { getPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const { getAllAuthProviders } = await import('./auth-providers')
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')

  // OIDC `locale` claim: shipped by Google, Microsoft, and most generic
  // OIDC IdPs. Pass it through so `user.locale` populates from sign-in
  // and the segment evaluator can target on language. Wrapped as a
  // permissive shape because each provider returns a slightly
  // different profile envelope.
  const mapProfileLocale = (profile: unknown): { locale: string | null } => {
    const p = profile as { locale?: unknown } | null | undefined
    return {
      locale: typeof p?.locale === 'string' && p.locale.length > 0 ? p.locale : null,
    }
  }

  // Build socialProviders config from DB-stored credentials
  const socialProviders: Record<string, Record<string, unknown>> = {}
  const trustedProviders: string[] = []
  const genericOAuthConfigs: Array<{
    providerId: string
    clientId: string
    clientSecret: string
    disableSignUp?: boolean
    discoveryUrl?: string
    pkce?: boolean
    authorizationUrl?: string
    tokenUrl?: string
    scopes?: string[]
    mapProfileToUser?: (profile: unknown) => Record<string, unknown>
    // SSO-only: force the IdP account picker so admins notice when
    // they're already signed in as a different identity.
    prompt?:
      | 'none'
      | 'login'
      | 'create'
      | 'consent'
      | 'select_account'
      | 'select_account consent'
      | 'login consent'
    // SSO-only: emit `login_hint` to pre-select the typed email in
    // the IdP picker. The ctx shape comes from Better-Auth's endpoint
    // builder; we only read `body.additionalData.loginHint` so we
    // accept a loose ctx type and narrow inside the function.
    authorizationUrlParams?: (ctx: {
      body?: { additionalData?: { loginHint?: string } }
    }) => Record<string, string>
  }> = []

  // Defense-in-depth: a workspace that configured SSO on a higher tier
  // would still have OIDC creds in the DB after a downgrade. Skip
  // generic-oauth providers when the tier flag is off so the login
  // button never renders and the /sign-in/oauth2 callback path 404s
  // on that providerId.
  //
  // Tier limits + tenant settings are independent reads — fire them
  // together to avoid stacking Redis round-trips on every auth-instance
  // rebuild. SSO config (non-secret fields on settings.authConfig.ssoOidc)
  // lives in DB; the client secret lives in platform_credentials with
  // type='auth_sso'. No env-var fallback — the platform vendor never
  // has the customer's IdP secret, so env-driven SSO never made sense
  // for managed-cloud and was a self-hosted-only quirk that's now gone.
  const [tierLimits, tenantSettings] = await Promise.all([getTierLimits(), getTenantSettings()])
  const ssoFromDb = tenantSettings?.authConfig?.ssoOidc

  // Registration condition is centralised in `isSsoActuallyRegistered`
  // so the email-first login dispatcher (lookupAuthMethodsFn) can
  // consult the same predicate — keeps registration and lookup from
  // disagreeing on whether SSO is live.
  const { getSsoClientSecret, isSsoActuallyRegistered } = await import('./sso-secret')
  const ssoRegistered = await isSsoActuallyRegistered(ssoFromDb, tierLimits)

  if (ssoFromDb?.enabled && tierLimits.features.customOidcProvider && !ssoRegistered) {
    // SSO is enabled and tier-allowed in DB but the secret is missing
    // (or got cleared). Skip registration; the rest of Better-Auth
    // (password + magic-link + other OAuth) keeps working. UI shows a
    // status banner asking the admin to paste the secret. Also warn
    // explicitly when the legacy env-var is set so self-hosters
    // upgrading from the env-fallback era have a breadcrumb.
    log.error(
      'sso enabled but no client secret in platform_credentials; set it via admin settings → security → authentication → single sign-on'
    )
    if (process.env.SSO_OIDC_CLIENT_SECRET) {
      log.warn(
        'sso client secret env var is set but no longer read at runtime; re-enter the secret via the admin ui to restore sso'
      )
    }
  }

  if (ssoRegistered) {
    const cfg = ssoFromDb!
    const clientSecret = await getSsoClientSecret()
    // `isSsoActuallyRegistered` already confirmed the secret exists, but
    // narrow the type for the push below.
    if (clientSecret) {
      genericOAuthConfigs.push({
        providerId: 'sso',
        clientId: cfg.clientId,
        clientSecret,
        discoveryUrl: cfg.discoveryUrl,
        scopes: ['openid', 'email', 'profile'],
        // PKCE on the authorization-code grant. OAuth 2.1 IdPs (e.g.
        // Supabase Auth's OAuth server) REQUIRE code_challenge on every
        // authorize request and reject without it; RFC 7636 §5 makes the
        // params backwards-compatible — IdPs that don't support PKCE
        // simply ignore them (Okta, Auth0, Entra, Keycloak all accept
        // it). Better-Auth threads code_verifier through the token
        // exchange when this flag is set.
        pkce: true,
        // Force the IdP to show the account-picker. Without this, an
        // admin typing demo@example.com at the login form gets
        // silently signed in as whoever the IdP already has a
        // session for (e.g. james.morton@quackback.io) — the IdP
        // re-uses its existing session because it has no reason to
        // re-prompt. With select_account, the IdP always asks the
        // user which account they want to sign in with so the
        // identity is explicit.
        prompt: 'select_account',
        // login_hint pre-selects the typed email in the IdP picker.
        // Read from the `additionalData.loginHint` body field that
        // the team-login / portal-auth forms pass when initiating
        // SSO. When the field is absent (e.g. a direct hit on
        // /sign-in/oauth2 with no email context) we omit the hint
        // and the IdP just shows its default account list.
        authorizationUrlParams: (ctx) => {
          const hint = ctx.body?.additionalData?.loginHint
          const params: Record<string, string> = {}
          if (hint) params.login_hint = hint
          return params
        },
        // Better-Auth's built-in JIT block. When false, the upstream
        // callback aborts in handleOAuthUserInfo BEFORE any user/
        // session is created, then redirects with `?error=signup_disabled`.
        // Existing users link via accountLinking.trustedProviders even
        // with this on. Picked up by createAuth() rebuilds via
        // resetAuth() / cross-pod invalidation when admins toggle it.
        disableSignUp: cfg.autoCreateUsers === false,
        mapProfileToUser: mapProfileLocale,
      })
      trustedProviders.push('sso')
    }
  }

  // Layer A registration filter: an OAuth provider is registered on
  // the Better-Auth instance only if creds exist AND at least one
  // surface (admin or portal) has it enabled. If both surfaces have
  // turned it off, skip registration so the button stops rendering on
  // every login page. Per-surface gating (admin vs portal) happens in
  // hooks.before/after — Better-Auth's provider list is a global
  // concept and can't be partitioned per-role at the auth-instance
  // level. Password and magic-link aren't covered here (they're
  // global Better-Auth features, not entries in AUTH_PROVIDERS).
  const teamOAuthConfig = (tenantSettings?.authConfig?.oauth ?? {}) as Record<
    string,
    boolean | undefined
  >
  const portalOAuthConfig = (tenantSettings?.portalConfig?.oauth ?? {}) as Record<
    string,
    boolean | undefined
  >
  const isOAuthProviderEnabledForAnySurface = (id: string): boolean => {
    return teamOAuthConfig[id] === true || portalOAuthConfig[id] === true
  }

  for (const provider of getAllAuthProviders()) {
    const creds = await getPlatformCredentials(provider.credentialType)
    if (!creds?.clientId || !creds?.clientSecret) continue
    if (!isOAuthProviderEnabledForAnySurface(provider.id)) continue

    if (provider.type === 'generic-oauth') {
      if (!tierLimits.features.customOidcProvider) continue
      // Generic OAuth providers use the genericOAuth plugin
      const scopeStr = creds.scopes || 'openid email profile'
      genericOAuthConfigs.push({
        providerId: provider.id,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        ...(creds.discoveryUrl && { discoveryUrl: creds.discoveryUrl }),
        ...(creds.authorizationUrl && { authorizationUrl: creds.authorizationUrl }),
        ...(creds.tokenUrl && { tokenUrl: creds.tokenUrl }),
        scopes: scopeStr.split(/\s+/).filter(Boolean),
        // PKCE on every generic-oauth provider too (portal Custom OIDC).
        // Same rationale as the 'sso' provider above: OAuth 2.1 IdPs
        // require code_challenge; RFC 7636 params are ignored by IdPs
        // without PKCE support, so it is safe to send unconditionally.
        pkce: true,
        mapProfileToUser: mapProfileLocale,
      })
      trustedProviders.push(provider.id)
    } else {
      // Built-in social providers
      const providerConfig: Record<string, unknown> = {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        mapProfileToUser: mapProfileLocale,
      }
      // Add provider-specific fields (e.g., tenantId for Microsoft, issuer for GitLab)
      for (const field of provider.platformCredentials) {
        if (field.key !== 'clientId' && field.key !== 'clientSecret' && creds[field.key]) {
          providerConfig[field.key] = creds[field.key]
        }
      }
      socialProviders[provider.id] = providerConfig
      trustedProviders.push(provider.id)
    }
  }

  // BASE_URL is required for auth callbacks and redirects
  const baseURL = config.baseUrl

  // Per-endpoint hooks for Layer B/C enforcement. Imported lazily here
  // to keep the createAuth() module-loading dependency graph clean.
  const { hooksBefore, hooksAfter } = await import('./hooks')

  const instance = betterAuth({
    hooks: {
      before: hooksBefore,
      after: hooksAfter,
    },
    // Use SECRET_KEY for auth signing (Better Auth defaults to BETTER_AUTH_SECRET)
    secret: config.secretKey,

    // Disable the JWT plugin's /token endpoint — conflicts with OAuth's /oauth2/token
    // Does NOT affect magicLink or session management
    disabledPaths: ['/token'],

    database: drizzleAdapter(db, {
      provider: 'pg',
      // Pass our custom schema so Better-auth uses our TypeID column types
      schema: {
        user: userTable,
        session: sessionTable,
        account: accountTable,
        verification: verificationTable,
        oneTimeToken: oneTimeTokenTable,
        // Better-Auth expects 'workspace' name for organization-like table
        workspace: settingsTable,
        member: principalTable,
        invitation: invitationTable,
        // OAuth 2.1 Provider + JWT plugin tables
        jwks: jwksTable,
        oauthClient: oauthClientTable,
        oauthAccessToken: oauthAccessTokenTable,
        oauthRefreshToken: oauthRefreshTokenTable,
        oauthConsent: oauthConsentTable,
        // The twoFactor plugin uses model name "twoFactor"; our Drizzle
        // table is `two_factor` (snake-case). The column→field mapping
        // (camelCase plugin field → snake_case column) is handled by
        // matching column names in the table definition itself.
        twoFactor: twoFactorTable,
      },
    }),

    // Base URL for auth callbacks and redirects
    baseURL,

    // Trusted origins for CORS/CSRF protection.
    // TRUSTED_ORIGINS (comma-separated) adds extra origins — useful for dev/test
    // environments where BASE_URL differs from the browser origin (e.g. ngrok + localhost).
    trustedOrigins: [
      baseURL,
      ...(process.env.TRUSTED_ORIGINS?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? []),
    ],

    // Tell Better-Auth about non-standard columns on `user` so the
    // OAuth `mapProfileToUser` return shape is allowed through and
    // written by drizzleAdapter. We only register `locale` here —
    // existing custom columns (metadata, isAnonymous, twoFactorEnabled,
    // imageKey) are written by other code paths (anonymous plugin /
    // databaseHooks / direct queries) and don't need to round-trip
    // through Better-Auth's signup validators.
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, input: false },
      },
    },

    // Password auth — default sign-in method for self-hosted deployments
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      async sendResetPassword({ user, url }) {
        if (!isEmailConfigured()) {
          log.warn(
            { user_id: user.id },
            'password reset requested but email is not configured; link not delivered'
          )
          return
        }
        const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
        const settings = await db.query.settings.findFirst({ columns: { logoKey: true } })
        const logoUrl = getEmailSafeUrl(settings?.logoKey) ?? undefined
        await sendPasswordResetEmail({ to: user.email, resetLink: url, logoUrl })
      },
      resetPasswordTokenExpiresIn: 60 * 60 * 24, // 24 hours
    },

    // Account linking - allow users to link multiple OAuth providers to their account
    // This is needed when a user signs up with email OTP, then later signs in with GitHub/Google
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders,
      },
    },

    // GitHub/Google OAuth via Better Auth's built-in socialProviders
    socialProviders,

    session: {
      storeSessionInDatabase: true,
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours
    },

    advanced: {
      // Use TypeID format for user IDs to match our schema
      database: {
        generateId: ({ model }) => {
          if (model === 'user') {
            return generateId('user')
          }
          // For session, verification, account - use crypto random (they use text columns)
          return crypto.randomUUID()
        },
      },
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: baseURL.startsWith('https://'),
      },
    },

    // Database hooks for OAuth user creation - creates member records
    // All OAuth signups get 'user' role (portal user)
    // Team members are added via invitations only
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Cast user.id to the branded TypeID type for database operations
            const userId = user.id as ReturnType<typeof generateId<'user'>>

            // Check if member already exists (in case of race conditions)
            const existingPrincipal = await db.query.principal.findFirst({
              where: eq(principalTable.userId, userId),
            })

            if (!existingPrincipal) {
              const isAnonymous = (user as Record<string, unknown>).isAnonymous === true
              await db.insert(principalTable).values({
                id: generateId('principal'),
                userId,
                role: 'user', // Always 'user' - team access via invitations only
                type: isAnonymous ? 'anonymous' : 'user',
                displayName: isAnonymous
                  ? await (async () => {
                      const { generateAnonymousName } = await import('@/lib/shared/anonymous-names')
                      return generateAnonymousName(user.id)
                    })()
                  : user.name,
                avatarUrl: isAnonymous ? null : (user.image ?? null),
                avatarKey: isAnonymous
                  ? null
                  : ((user as Record<string, unknown>).imageKey as string | null),
                createdAt: new Date(),
              })
              log.info(
                { user_id: user.id, role: 'user', type: isAnonymous ? 'anonymous' : 'user' },
                'created principal record'
              )
            }
          },
        },
      },
    },

    plugins: [
      // magicLink + emailOTP plugins stash tokens; callers in
      // auth/email-signin.ts and auth/magic-link-mint.ts drain the
      // stashes and ship their own email templates.
      magicLink({
        async sendMagicLink({ email, token }) {
          storeMagicLinkToken(email, token)
        },
        // 10 min matches the OTP expiry + the user-facing claim in the
        // sign-in email. Bootstrap claim URLs need a longer window —
        // see `extendMagicLinkExpiry` in `magic-link-mint.ts` which
        // pushes their verification row out to 7 days post-mint.
        expiresIn: 60 * 10,
        disableSignUp: false,
        // Outlook Safe Links / Slack unfurl can consume tokens before the user clicks.
        allowedAttempts: 3,
      }),

      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          storeOTP(email, otp)
        },
        otpLength: 6,
        expiresIn: 600,
      }),

      // One-time token plugin for cross-domain session transfer.
      // expiresIn is in MINUTES (the plugin multiplies by 60 000 ms internally).
      // 10 min: the OTT sign-in flow needs more headroom than the default —
      // the user may take time between clicking the widget CTA and the portal
      // page loading (slow connection, tab restore, etc.).
      oneTimeToken({
        expiresIn: 10,
      }),

      // JWT plugin — signs access tokens, exposes /api/auth/jwks for verification
      jwt(),

      // OAuth 2.1 Provider — turns Better Auth into an authorization server for MCP
      oauthProvider({
        // Redirect unauthenticated OAuth users to portal login
        loginPage: '/auth/login',

        // Consent page — always shown for non-trusted clients
        consentPage: '/oauth/consent',

        // Allow Claude Code (and other MCP clients) to self-register
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,

        // Quackback-specific scopes
        scopes: [
          'openid',
          'profile',
          'email',
          'offline_access',
          'read:feedback',
          'write:feedback',
          'write:changelog',
          'read:article',
          'write:article',
          'read:chat',
          'write:chat',
        ],

        // Default scopes for dynamically registered clients
        clientRegistrationDefaultScopes: [
          'openid',
          'profile',
          'email',
          'read:feedback',
          'offline_access',
          'write:feedback',
          'write:changelog',
          'read:article',
          'write:article',
          'read:chat',
          'write:chat',
        ],

        // MCP endpoint is a valid token audience
        validAudiences: [`${baseURL}/api/mcp`],

        // Better Auth warns that /.well-known/oauth-authorization-server/api/auth
        // doesn't exist, but we intentionally serve metadata at the root well-known
        // path (matching the official Better Auth demo pattern — see #7453)
        silenceWarnings: { oauthAuthServerConfig: true },

        // Embed principal info in the JWT so MCP handler can avoid extra DB lookups
        customAccessTokenClaims: async ({ user }) => {
          if (!user?.id) return {}
          const p = await db.query.principal.findFirst({
            where: eq(principalTable.userId, user.id as ReturnType<typeof generateId<'user'>>),
            columns: { id: true, role: true },
          })
          return {
            principalId: p?.id,
            role: p?.role ?? 'user',
            name: user.name,
            email: user.email,
          }
        },
      }),

      // Generic OAuth plugin for custom OIDC providers (Okta, Auth0, Keycloak, etc.)
      ...(genericOAuthConfigs.length > 0 ? [genericOAuth({ config: genericOAuthConfigs })] : []),

      // Anonymous authentication plugin — enables voting without sign-up
      anonymous({
        emailDomainName: ANON_EMAIL_DOMAIN,
        disableDeleteAnonymousUser: true, // we handle cleanup ourselves to avoid cascade-deleting sessions
        async onLinkAccount({ anonymousUser, newUser }) {
          const anonUserId = anonymousUser.user.id as ReturnType<typeof generateId<'user'>>
          const newUserId = newUser.user.id as ReturnType<typeof generateId<'user'>>

          // Check if the new user is a freshly created account or an existing one
          const [existingPrincipal, anonPrincipal] = await Promise.all([
            db.query.principal.findFirst({ where: eq(principalTable.userId, newUserId) }),
            db.query.principal.findFirst({ where: eq(principalTable.userId, anonUserId) }),
          ])
          const isExistingUser = existingPrincipal && existingPrincipal.type !== 'anonymous'

          if (isExistingUser) {
            // SIGN-IN to existing account: transfer anonymous activity to the existing user,
            // then clean up the anonymous user.
            if (anonPrincipal) {
              const { mergeAnonymousToIdentified } = await import('./merge-anonymous')
              await mergeAnonymousToIdentified({
                anonPrincipalId: anonPrincipal.id as ReturnType<typeof generateId<'principal'>>,
                targetPrincipalId: existingPrincipal.id as ReturnType<
                  typeof generateId<'principal'>
                >,
                anonUserId,
                anonDisplayName: anonPrincipal.displayName || 'Anonymous',
                targetDisplayName: newUser.user.name || 'User',
              })
            }

            log.info(
              { anon_user_id: anonUserId, existing_user_id: newUserId },
              'linked anonymous user to existing account'
            )
          } else {
            // SIGN-UP (new account): keep the anonymous user, absorb the new user into it.
            // This preserves sessions, principal, votes, comments on the same userId.
            const newImage =
              ((newUser.user as Record<string, unknown>).image as string | null) ?? null

            await db.transaction(async (tx) => {
              // Move account+session refs to anon user (before deleting new user)
              await Promise.all([
                tx
                  .update(accountTable)
                  .set({ userId: anonUserId })
                  .where(eq(accountTable.userId, newUserId)),
                tx
                  .update(sessionTable)
                  .set({ userId: anonUserId })
                  .where(eq(sessionTable.userId, newUserId)),
              ])
              // Delete the new user (frees the email for the anon user update)
              if (existingPrincipal) {
                await tx.delete(principalTable).where(eq(principalTable.id, existingPrincipal.id))
              }
              await tx.delete(userTable).where(eq(userTable.id, newUserId))
              // Update the anon user with real identity + upgrade principal
              await Promise.all([
                tx
                  .update(userTable)
                  .set({
                    name: newUser.user.name,
                    email: newUser.user.email,
                    emailVerified: true,
                    isAnonymous: false,
                    image: newImage,
                  })
                  .where(eq(userTable.id, anonUserId)),
                tx
                  .update(principalTable)
                  .set({
                    type: 'user',
                    displayName: newUser.user.name || anonymousUser.user.name,
                    avatarUrl: newImage,
                  })
                  .where(eq(principalTable.userId, anonUserId)),
              ])
            })

            // The principal's `type` flipped from 'anonymous' → 'user'; drop
            // any cached entry so the next SSR render reads the new value.
            const { cacheDel, CACHE_KEYS } = await import('@/lib/server/redis')
            await cacheDel(CACHE_KEYS.PRINCIPAL_BY_USER(anonUserId))

            log.info(
              { anon_user_id: anonUserId, deleted_user_id: newUserId },
              'linked anonymous user to new account'
            )
          }
        },
      }),

      // Bearer token plugin — converts Authorization: Bearer headers to session lookups.
      // Used by the widget iframe which can't set cookies in cross-origin contexts.
      bearer(),

      // TOTP-based 2FA. Adds /two-factor/enable, /two-factor/verify, etc.
      // No UI yet — surfaced in user profile + sign-in challenge in
      // subsequent tasks.
      twoFactor({
        issuer: 'Quackback',
        totpOptions: {
          period: 30,
          digits: 6,
        },
      }),

      // TanStack Start cookie management plugin (must be last)
      tanstackStartCookies(),
    ],
  })

  return { instance, authConfigVersion: tenantSettings?.settings?.authConfigVersion ?? 0 }
}

/**
 * Get the auth instance (lazy-initialized).
 *
 * Cross-pod invalidation: every call reads the cached settings row's
 * `authConfigVersion` (one Redis hit, already happens for everything
 * else). If the cached _auth was built against an older version, drop
 * it and rebuild. This guarantees that a write on pod A propagates to
 * pod B no later than its next request after pod A's commit. The
 * version is bumped by `bumpAuthConfigVersionInTx` from every
 * auth-instance-affecting write path.
 */
export async function getAuth(): Promise<AuthInstance> {
  // Skip the version check when no instance is cached yet — the build
  // path below records the version after creation.
  if (_auth && _authConfigVersion !== null) {
    const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
    const t = await getTenantSettings()
    const current = t?.settings?.authConfigVersion
    if (typeof current === 'number' && current !== _authConfigVersion) {
      _auth = null
      _authConfigVersion = null
    }
  }
  if (!_auth) {
    const built = await createAuth()
    _auth = built.instance
    _authConfigVersion = built.authConfigVersion
  }
  return _auth
}

/**
 * Reset the auth instance so it's re-created on next access.
 * Call after changing auth provider credentials in the DB.
 */
export function resetAuth(): void {
  _auth = null
  _authConfigVersion = null
}

// Export a proxy object that lazily initializes auth on first access
// This maintains backwards compatibility with `auth.api.getSession()` style calls
export const auth = {
  get api() {
    // Create a proxy for the API that awaits initialization
    return new Proxy({} as AuthInstance['api'], {
      get(_, prop) {
        return async (...args: unknown[]) => {
          const authInstance = await getAuth()
          const api = authInstance.api as Record<string, (...args: unknown[]) => unknown>
          return api[prop as string](...args)
        }
      },
    })
  },
  async handler(request: Request) {
    const url = new URL(request.url)
    const isMagicLink = url.pathname.includes('magic-link')
    if (isMagicLink) {
      log.debug({ method: request.method, path: url.pathname }, 'magic-link request')
    }
    const authInstance = await getAuth()
    const response = await authInstance.handler(request)
    if (isMagicLink) {
      log.debug({ status: response.status }, 'magic-link response')
    }
    return response
  },
}

export type Auth = AuthInstance

// Role-based access control

export { type Role, isTeamMember, isAdmin } from '@/lib/shared/roles'

import type { Role } from '@/lib/shared/roles'
import { ANON_EMAIL_DOMAIN } from '@/lib/shared/anonymous-email'

const levels: Record<Role, number> = {
  admin: 3,
  member: 2,
  user: 1,
}

/** Check if role meets minimum level: hasRole('admin', 'member') → true */
export function hasRole(role: Role, minimum: Role): boolean {
  return levels[role] >= levels[minimum]
}

/** Check if role is in allowed list: canAccess('admin', ['admin']) → true */
export function canAccess(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role)
}
