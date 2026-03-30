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
} from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { generateId } from '@featurepool/ids'
import { config } from '@/lib/server/config'

/** Temporary storage for magic link tokens during invitation flow */
const pendingMagicLinkTokens = new Map<string, { token: string; timestamp: number }>()
function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  )
}

function getDevelopmentTrustedOrigin(request?: Request): string | null {
  if (!request) return null

  try {
    const url = new URL(request.url)
    return isLoopbackHostname(url.hostname) ? url.origin : null
  } catch {
    return null
  }
}

export function storeMagicLinkToken(email: string, token: string): void {
  const normalizedEmail = email.toLowerCase()
  pendingMagicLinkTokens.set(normalizedEmail, { token, timestamp: Date.now() })

  // Clean up after 30 seconds (invitation flow should retrieve immediately)
  setTimeout(() => {
    const stored = pendingMagicLinkTokens.get(normalizedEmail)
    if (stored && Date.now() - stored.timestamp >= 30000) {
      pendingMagicLinkTokens.delete(normalizedEmail)
    }
  }, 30000)
}

export function getMagicLinkToken(email: string): string | undefined {
  const normalizedEmail = email.toLowerCase()
  const stored = pendingMagicLinkTokens.get(normalizedEmail)
  if (!stored) return undefined

  pendingMagicLinkTokens.delete(normalizedEmail)
  return stored.token
}

// Lazy-initialized auth instance
// This prevents client bundling of database code
type AuthInstance = Awaited<ReturnType<typeof createAuth>>
let _auth: AuthInstance | null = null

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
    eq,
  } = await import('@/lib/server/db')
  const { sendSigninCodeEmail, sendPasswordResetEmail, isEmailConfigured } =
    await import('@featurepool/email')
  const { getPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const { getAllAuthProviders } = await import('./auth-providers')

  // Build socialProviders config from DB-stored credentials
  const socialProviders: Record<string, Record<string, string>> = {}
  const trustedProviders: string[] = []
  const genericOAuthConfigs: Array<{
    providerId: string
    clientId: string
    clientSecret: string
    discoveryUrl?: string
    authorizationUrl?: string
    tokenUrl?: string
    scopes?: string[]
  }> = []

  for (const provider of getAllAuthProviders()) {
    const creds = await getPlatformCredentials(provider.credentialType)
    if (!creds?.clientId || !creds?.clientSecret) continue

    if (provider.type === 'generic-oauth') {
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
      })
      trustedProviders.push(provider.id)
    } else {
      // Built-in social providers
      const providerConfig: Record<string, string> = {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
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

  const configuredBaseUrl = config.baseUrl
  const isDevelopment = config.nodeEnv === 'development'
  // Keep a concrete base URL for Better Auth plugin initialization.
  // Some plugins (notably the OAuth provider) read ctx.baseURL during init and
  // currently break when Better Auth is configured with a dynamic baseURL object.
  const baseURL = configuredBaseUrl
  const trustedOrigins = isDevelopment
    ? async (request?: Request) => {
        const requestOrigin = getDevelopmentTrustedOrigin(request)
        return requestOrigin && requestOrigin !== configuredBaseUrl
          ? [configuredBaseUrl, requestOrigin]
          : [configuredBaseUrl]
      }
    : [configuredBaseUrl]

  //console.log("ENV CHECK:", {
  //  secret: process.env.BETTER_AUTH_SECRET,
  //  databaseUrl: process.env.DATABASE_URL,
  //})

  //try{

  return betterAuth({
    // Use SECRET_KEY for auth signing (Better Auth defaults to BETTER_AUTH_SECRET)
    secret: config.secretKey,

    // Disable the JWT plugin's /token endpoint — conflicts with OAuth's /oauth2/token
    // Does NOT affect emailOTP, magicLink, or session management
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
      },
    }),

    // Base URL for auth callbacks and redirects
    baseURL,

    // Trusted origins for CORS/CSRF protection
    trustedOrigins,

    // Password auth — default sign-in method for self-hosted deployments
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      async sendResetPassword({ user, url }) {
        if (!isEmailConfigured()) {
          console.warn(
            `[auth] Password reset requested for ${user.email} but email is not configured. Link will not be delivered.`
          )
          return
        }
        await sendPasswordResetEmail({ to: user.email, resetLink: url })
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
              console.log(
                `[auth] Created principal record: userId=${user.id}, role=user, type=${isAnonymous ? 'anonymous' : 'user'}`
              )
            }
          },
        },
      },
    },

    plugins: [
      // Email OTP plugin for passwordless authentication (used by portal users)
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          if (!isEmailConfigured()) {
            console.warn(
              `[auth] Email OTP requested for ${email} but email is not configured. OTP will not be delivered.`
            )
          }
          await sendSigninCodeEmail({ to: email, code: otp })
        },
        otpLength: 6,
        expiresIn: 600, // 10 minutes
      }),

      // Magic link plugin for team member invitations
      // When invitations are sent, the sendMagicLink callback stores the token
      // which is then retrieved by sendInvitationFn to build the URL with correct workspace domain
      magicLink({
        async sendMagicLink({ email, token }) {
          // Store only the token - we'll construct the URL with the workspace domain
          storeMagicLinkToken(email, token)
        },
        expiresIn: 60 * 60 * 24 * 7, // 7 days - match invitation expiry
        disableSignUp: false, // Allow new users to sign up via invitation
        allowedAttempts: 3, // Allow multiple attempts (Outlook Safe Links consumes tokens)
      }),

      // One-time token plugin for cross-domain session transfer (used by /get-started)
      oneTimeToken({
        expiresIn: 60, // 1 minute - tokens are used immediately after generation
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

        // Featurepool-specific scopes
        scopes: [
          'openid',
          'profile',
          'email',
          'offline_access',
          'read:feedback',
          'write:feedback',
          'write:changelog',
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
        ],

        // MCP endpoint is a valid token audience
        validAudiences: [`${configuredBaseUrl}/api/mcp`],

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
        emailDomainName: 'anon.featurepool.io',
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

            console.log(
              `[auth] Linked anonymous to existing: anonUserId=${anonUserId} → existingUserId=${newUserId}`
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

            console.log(
              `[auth] Linked anonymous to new account: kept anonUserId=${anonUserId}, deleted newUserId=${newUserId}`
            )
          }
        },
      }),

      // Bearer token plugin — converts Authorization: Bearer headers to session lookups.
      // Used by the widget iframe which can't set cookies in cross-origin contexts.
      bearer(),

      // TanStack Start cookie management plugin (must be last)
      tanstackStartCookies(),
    ],
  })

  //} catch (err) {
  //  console.error("🔥 BETTER AUTH INIT ERROR:", err)
  //  throw err
  //}
}

/**
 * Get the auth instance (lazy-initialized).
 * This allows dynamic imports of database code to prevent client bundling.
 */
export async function getAuth(): Promise<AuthInstance> {
  if (!_auth) {
    _auth = await createAuth()
  }
  return _auth
}

/**
 * Reset the auth instance so it's re-created on next access.
 * Call after changing auth provider credentials in the DB.
 */
export function resetAuth(): void {
  _auth = null
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
      console.log(`[auth] magic-link request: ${request.method} ${url.pathname}${url.search}`)
    }
    const authInstance = await getAuth()
    const response = await authInstance.handler(request)
    if (isMagicLink) {
      const location = response.headers.get('location')
      console.log(
        `[auth] magic-link response: status=${response.status}, location=${location ?? 'none'}`
      )
    }
    return response
  },
}

export type Auth = AuthInstance

// Role-based access control

export { type Role, isTeamMember, isAdmin } from '@/lib/shared/roles'

import type { Role } from '@/lib/shared/roles'

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
