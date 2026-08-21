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
import { generateId, type PrincipalId, type UserId } from '@quackback/ids'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import type { GenericOAuthConfig } from './build-oauth-configs'
import { isSignInMethodEnabled } from '@/lib/shared/signin-methods'

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
/**
 * OTP purposes the plugin issues.
 *
 * Only sign-in codes are stashed: they are the one purpose whose code has to
 * survive the callback, because `requestEmailSignin` combines it with a magic
 * link in a single email. Everything else is sent from the callback itself.
 *
 * The key still carries the purpose. Two purposes can be live for one address
 * at the same moment, so an address-only key would let the second overwrite the
 * first and hand whoever drained the stash the wrong code — a footgun waiting
 * for the next purpose that needs stashing rather than a live bug today.
 */
export type OtpPurpose = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

const otpKey = (purpose: OtpPurpose, email: string) => `${purpose}:${email}`

export const storeOTP = (purpose: OtpPurpose, email: string, otp: string) =>
  otpStash.set(otpKey(purpose, email), otp)
export const getOTP = (purpose: OtpPurpose, email: string) => otpStash.take(otpKey(purpose, email))

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
  const { listIdentityProviders, getIdentityProviderCredentials } =
    await import('@/lib/server/domains/settings/identity-providers.service')
  const { buildGenericOAuthConfigs } = await import('./build-oauth-configs')
  const { ensurePrincipalForUser } =
    await import('@/lib/server/domains/principals/principal.factory')

  // login_hint pre-selects the typed email in the IdP picker. Read from
  // the `additionalData.loginHint` body field that the team-login /
  // portal-auth forms pass when initiating an OIDC sign-in. When absent
  // (e.g. a direct hit on /sign-in/oauth2 with no email context) the hint
  // is omitted and the IdP shows its default account list. Carried to
  // every OIDC provider since any of them may be domain-routed.
  const buildLoginHintParams = (ctx: {
    body?: { additionalData?: { loginHint?: string } }
  }): Record<string, string> => {
    const hint = ctx.body?.additionalData?.loginHint
    const params: Record<string, string> = {}
    if (hint) params.login_hint = hint
    return params
  }

  // Build socialProviders config from DB-stored credentials
  const socialProviders: Record<string, Record<string, unknown>> = {}
  const trustedProviders: string[] = []
  const genericOAuthConfigs: GenericOAuthConfig[] = []

  // Tier limits + tenant settings are independent reads — fire them
  // together to avoid stacking cache round-trips on every auth-instance
  // rebuild. tenantSettings still drives the social-provider surface
  // filter below; OIDC config now comes from the identity_provider list.
  const [tierLimits, tenantSettings] = await Promise.all([getTierLimits(), getTenantSettings()])

  // OIDC providers (single sign-on + portal custom OIDC) are registered
  // from the identity_provider list — the single source of truth. Each
  // provider keeps its own registrationId as the Better-Auth providerId
  // (migrated rows preserve 'sso'/'custom-oidc'), so the OAuth redirect
  // URI is stable and needs no IdP reconfiguration. Tier-gated inside
  // buildGenericOAuthConfigs: a downgraded workspace stops registering
  // OIDC even though the rows remain. The login_hint params are carried
  // to every provider since any may be domain-routed.
  // Discovery and userinfo are fetched through the SSRF-guarded helper, and
  // resolved HERE rather than inside the resolver: the plugin's getUserInfo
  // seam receives only the token set, so without closing the endpoint over at
  // build time every sign-in would re-fetch discovery. Rebuilt whenever
  // auth_config_version changes, which is the same cadence the rest of this
  // config already refreshes on. A discovery outage returns null and the
  // provider still registers — a complete ID token needs no userinfo.
  const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
  const fetchJson = async (url: string, headers?: Record<string, string>) => {
    try {
      const res = await safeFetch(url, { ...(headers ? { headers } : {}), timeoutMs: 5000 })
      if (!res.ok) return null
      const body: unknown = await res.json()
      return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  /**
   * The address to use for a provider that released none: the one already on
   * file for this identity, or a freshly minted one if this is a first sign-in.
   *
   * Read-or-mint, because `getUserInfo` runs on every sign-in. Minting each
   * time would churn the person's address on every visit and break anything
   * holding the old one. Only reached when the provider opted in AND no real
   * address came through, so the lookup costs nothing for everyone else.
   */
  const resolvePlaceholderEmail = async (
    registrationId: string,
    accountId: string
  ): Promise<string> => {
    const { db, account, user, and, eq } = await import('@/lib/server/db')
    const existing = await db.query.account.findFirst({
      where: and(eq(account.providerId, registrationId), eq(account.accountId, accountId)),
      columns: { userId: true },
    })
    if (existing?.userId) {
      const owner = await db.query.user.findFirst({
        where: eq(user.id, existing.userId),
        columns: { email: true },
      })
      if (owner?.email) return owner.email
    }
    const { mintPlaceholderEmail } = await import('./placeholder-identity')
    const minted = mintPlaceholderEmail(registrationId)
    log.info({ registrationId }, 'minted placeholder address for provider with no email claim')
    return minted
  }

  const providerRows = await listIdentityProviders()
  const oidcConfigs = await buildGenericOAuthConfigs({
    providers: providerRows,
    creds: getIdentityProviderCredentials,
    tierAllowsOidc: tierLimits.features.customOidcProvider,
    discovery: (discoveryUrl) => fetchJson(discoveryUrl),
    fetchUserInfo: (url, accessToken) => fetchJson(url, { authorization: `Bearer ${accessToken}` }),
    // Observe-then-enforce: log the discrepancy so its real rate is known
    // before any release starts refusing sign-ins over it.
    onResolved: (registrationId, accountId, claims) => {
      stashResolvedClaims(registrationId, accountId, claims)
    },
    onResolutionWarning: (registrationId, warnings) => {
      log.warn({ registrationId, warnings }, 'identity resolution discrepancy observed')
    },
    placeholderEmailFor: resolvePlaceholderEmail,
    mapProfileToUser: mapProfileClaims,
    buildLoginHintParams,
  })
  genericOAuthConfigs.push(...oidcConfigs)

  // Auto-linking attaches an incoming identity to an existing local account on
  // address match alone. Every OIDC provider is trusted for that today, which
  // is defensible for a corporate IdP the workspace controls and much weaker
  // for a public one where anyone can register the address of somebody who
  // already has an account here.
  //
  // Observed, not enforced. Withdrawing it outright would stop existing
  // password users linking on their first SSO sign-in and start returning
  // "account not linked" — a regression for providers that are behaving
  // perfectly well. So log which providers would lose it, size the blast radius
  // from real installations, and flip afterwards. Two of the predicate's inputs
  // (whether the provider asserts a verified address, and an admin override)
  // also need a column that has not landed yet.
  const { allowsAutoLinking } = await import('./provider-trust')
  for (const c of oidcConfigs) {
    trustedProviders.push(c.providerId)
    const row = providerRows.find((p) => p.registrationId === c.providerId)
    if (
      row &&
      !allowsAutoLinking({
        lastSuccessfulTestAt: row.lastSuccessfulTestAt,
        detailsChangedAt: row.detailsChangedAt,
        // Not yet persisted; assumed true so the observation isolates the
        // connection-test signal rather than flagging every provider.
        assertsVerifiedEmail: true,
        trustOverride: null,
      })
    ) {
      log.warn(
        { registrationId: c.providerId },
        'provider would lose auto-linking under derived trust (no fresh connection test)'
      )
    }
  }

  // Layer A registration filter: an OAuth provider is registered on
  // the Better-Auth instance only if creds exist AND `authConfig.oauth`
  // has it enabled. If the admin hasn't opted in, skip registration so
  // the button stops rendering on every login page. Per-flow gating
  // (admin vs portal sign-in) happens in hooks.before/after —
  // Better-Auth's provider list is a global concept and can't be
  // partitioned per-role at the auth-instance level. Password and
  // magic-link aren't covered here (they're global Better-Auth features,
  // not entries in AUTH_PROVIDERS).
  const unifiedOAuthConfig = (tenantSettings?.authConfig?.oauth ?? {}) as Record<
    string,
    boolean | undefined
  >

  for (const provider of getAllAuthProviders()) {
    // OIDC providers are owned by the identity_provider list above. Skip
    // them here so custom-oidc isn't re-registered as a (broken) social
    // provider once the generic-oauth sub-branch is gone.
    if (provider.type === 'generic-oauth') continue

    const creds = await getPlatformCredentials(provider.credentialType)
    if (!creds?.clientId || !creds?.clientSecret) continue
    if (!isSignInMethodEnabled(unifiedOAuthConfig, provider.id)) continue

    // Built-in social providers
    const providerConfig: Record<string, unknown> = {
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      mapProfileToUser: mapProfileClaims,
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
    // Route the library's internal logging through pino, redacted. Without it
    // those lines bypass the app logger entirely — unstructured, uncorrelated,
    // and on a resolution failure carrying the whole user-info payload
    // including the email address.
    logger: createAuthLogger(log),
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
        // Account class: the reset link is a capability over THIS account, so
        // the recipient is looked up by id and can never be a contact address
        // somebody else supplied.
        const { resolveAccountRecipient } = await import('@/lib/server/email/recipient')
        const to = await resolveAccountRecipient(user.id as UserId)
        if (!to) {
          log.warn(
            { user_id: user.id },
            'password reset requested but the account has no deliverable address'
          )
          return
        }
        const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
        const settings = await db.query.settings.findFirst({ columns: { logoKey: true } })
        const logoUrl = getEmailSafeUrl(settings?.logoKey) ?? undefined
        await sendPasswordResetEmail({ to, resetLink: url, logoUrl })
      },
      resetPasswordTokenExpiresIn: 60 * 60 * 24, // 24 hours
      // Completing a reset proves inbox ownership (the user received and
      // used the emailed token), so mark the email verified. Password
      // signup never verifies otherwise, and an unverified local user is
      // blocked from linking OAuth/OIDC providers into their account.
      async onPasswordReset({ user }) {
        if (!user.emailVerified) {
          await db
            .update(userTable)
            .set({ emailVerified: true, updatedAt: new Date() })
            .where(eq(userTable.id, user.id as UserId))
        }
      },
    },

    // Account linking - allow users to link multiple OAuth providers to their account
    // This is needed when a user signs up with email OTP, then later signs in with GitHub/Google
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders,
        // Let someone already signed in attach a provider whose address differs
        // from their account's. Without it a provider that releases no email —
        // and therefore signs people in under a placeholder address — can never
        // be linked to a real account at all, which is the population this work
        // adds.
        //
        // Safe because this gates the DELIBERATE flows only: the explicit link
        // endpoint and the account-linking API, both authorised by an existing
        // session rather than by the address. Auto-linking is untouched, since
        // it finds the user BY email and so is an address match by definition.
        allowDifferentEmails: true,
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

            const isAnonymous = (user as Record<string, unknown>).isAnonymous === true
            const displayName = isAnonymous
              ? await (async () => {
                  const { generateAnonymousName } = await import('@/lib/shared/anonymous-names')
                  return generateAnonymousName(user.id)
                })()
              : user.name
            // Race-safe lazy create (the factory's onConflictDoNothing subsumes
            // the prior explicit findFirst guard). Always 'user' — team access is
            // via invitations only.
            const { principal: createdPrincipal, created } = await ensurePrincipalForUser({
              userId,
              role: 'user',
              type: isAnonymous ? 'anonymous' : 'user',
              displayName,
              avatarUrl: isAnonymous ? null : (user.image ?? null),
              avatarKey: isAnonymous
                ? null
                : ((user as Record<string, unknown>).imageKey as string | null),
            })
            if (created) {
              log.info(
                { user_id: user.id, role: 'user', type: isAnonymous ? 'anonymous' : 'user' },
                'created principal record'
              )
              // Changelog auto-subscribe touchpoint (Changelog Settings §2):
              // "first portal interaction" — a brand-new portal account,
              // covering password/magic-link/OAuth/OTP signup in one place.
              // Anonymous placeholder accounts are skipped (no real email yet).
              if (!isAnonymous) {
                const { ensureAutoSubscribed } =
                  await import('@/lib/server/domains/changelog/changelog-subscription.service')
                ensureAutoSubscribed(createdPrincipal.id as PrincipalId).catch((err) =>
                  log.error({ err }, 'failed to auto-subscribe to changelog on signup')
                )
              }
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
      }),

      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          // Sign-in codes are stashed and drained by `requestEmailSignin`,
          // which combines them with a magic link in one email. Every other
          // purpose has no such caller, so it is sent from here.
          if (type === 'sign-in') {
            storeOTP('sign-in', email, otp)
            return
          }

          // A password-reset code is a capability: it is redeemable for a new
          // password, so it must not go out under "Confirm your email" copy,
          // and it must not reach an address this flow did not verify. Nothing
          // wires it here today (the app uses core `requestPasswordReset`), and
          // this refuses loudly rather than mailing the wrong thing if
          // something ever does.
          if (type === 'forget-password') {
            throw new Error(
              'forget-password OTP is not wired through emailOTP; use requestPasswordReset'
            )
          }

          // `email-verification` (adding a first address) and `change-email`
          // (moving to a new one) both mean the same thing to the recipient:
          // prove you hold this address.
          const { sendVerifyAddressEmail } = await import('@quackback/email')
          const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
          const settings = await db.query.settings.findFirst({
            columns: { name: true, logoKey: true },
          })
          await sendVerifyAddressEmail({
            to: email,
            code: otp,
            workspaceName: settings?.name ?? undefined,
            logoUrl: getEmailSafeUrl(settings?.logoKey) ?? undefined,
          })
        },
        otpLength: 6,
        expiresIn: 600,
        // Changing an address is a two-step proof, but `verifyCurrentEmail` is a
        // static boolean and turning it on would demand a code at an address
        // that cannot receive one — locking out exactly the people whose
        // provider releases no email. The current-address step is therefore
        // enforced conditionally in the server function instead.
        changeEmail: { enabled: true, verifyCurrentEmail: false },
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
        // (RFC 7591). Admin-toggleable via Settings > Developers; the
        // service bumps auth_config_version on change, so the toggle takes
        // effect without a restart via the normal instance rebuild.
        // `?? true` also covers cached settings serialized before the key
        // existed.
        allowDynamicClientRegistration:
          tenantSettings?.developerConfig?.oauthDynamicClientRegistrationEnabled ?? true,
        allowUnauthenticatedClientRegistration: true,

        // Identity scopes plus the shared capability vocabulary (the same
        // list API keys store and the MCP tools enforce).
        scopes: ['openid', 'profile', 'email', 'offline_access', ...API_KEY_SCOPES],

        // Default scopes when a registering client omits `scope` (RFC 7591).
        // Real MCP clients (Claude Code, MCP SDK per SEP-835) resolve their
        // scope list from the protected-resource metadata's scopes_supported
        // and send it explicitly at registration, so these defaults only
        // apply to clients that ask for nothing. Keep that fallback
        // read-only with no offline_access: an unknown silent client gets
        // no write access and no refresh token unless it asks.
        clientRegistrationDefaultScopes: [
          'openid',
          'profile',
          'email',
          ...API_KEY_SCOPES.filter((s) => s.startsWith('read:')),
        ],

        // Setting clientRegistrationDefaultScopes alone would also narrow
        // the set a registering client may REQUEST to those defaults and
        // reject MCP clients' explicit write/offline_access registrations,
        // so allow the full catalogue for explicit requests.
        clientRegistrationAllowedScopes: [
          'openid',
          'profile',
          'email',
          'offline_access',
          ...API_KEY_SCOPES,
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
          const anonUserId = anonymousUser.user.id as UserId
          const newUserId = newUser.user.id as UserId

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
                anonPrincipalId: anonPrincipal.id as PrincipalId,
                targetPrincipalId: existingPrincipal.id as PrincipalId,
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
            // SIGN-UP (new account): keep the anonymous user, absorb the new
            // user into it. The absorb shares the principal re-point registry
            // and factory teardown with the sign-in merge above.
            const newImage =
              ((newUser.user as Record<string, unknown>).image as string | null) ?? null

            const { absorbSignupIntoAnonymous } = await import('./merge-anonymous')
            const { cacheKeysToBust } = await absorbSignupIntoAnonymous({
              anonUserId,
              anonPrincipalId: anonPrincipal ? (anonPrincipal.id as PrincipalId) : null,
              newUserId,
              newUserPrincipalId: existingPrincipal ? (existingPrincipal.id as PrincipalId) : null,
              name: newUser.user.name,
              email: newUser.user.email,
              image: newImage,
              displayName: newUser.user.name || anonymousUser.user.name,
            })

            // The principal's `type` flipped from 'anonymous' → 'user'; drop
            // any cached entry so the next SSR render reads the new value.
            const { cacheDel } = await import('@/lib/server/cache')
            await cacheDel(...cacheKeysToBust)

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
 * `authConfigVersion` (one cache hit, already happens for everything
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
import { mapProfileClaims } from '@/lib/server/auth/map-profile-claims'
import { createAuthLogger } from '@/lib/server/auth/auth-logger-adapter'
import { stashResolvedClaims } from '@/lib/server/auth/resolved-claims-stash'

/** Check if role is in allowed list: canAccess('admin', ['admin']) → true */
export function canAccess(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role)
}
