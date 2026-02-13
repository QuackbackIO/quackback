import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, oneTimeToken, magicLink, jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { generateId } from '@quackback/ids'
import { config } from '@/lib/server/config'

/** Temporary storage for magic link tokens during invitation flow */
const pendingMagicLinkTokens = new Map<string, { token: string; timestamp: number }>()

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
let _auth: ReturnType<typeof betterAuth> | null = null

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
  const { sendSigninCodeEmail } = await import('@quackback/email')
  const { getPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const { getAllAuthProviders } = await import('./auth-providers')

  // Build socialProviders config from DB-stored credentials
  const socialProviders: Record<string, Record<string, string>> = {}
  const trustedProviders: string[] = []

  for (const provider of getAllAuthProviders()) {
    const creds = await getPlatformCredentials(provider.credentialType)
    if (creds?.clientId && creds?.clientSecret) {
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

  // BASE_URL is required for auth callbacks and redirects
  const baseURL = config.baseUrl

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
    trustedOrigins: [baseURL],

    // Password auth — default sign-in method for self-hosted deployments
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
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
        // Secure cookies only when served over HTTPS
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
              await db.insert(principalTable).values({
                id: generateId('principal'),
                userId,
                role: 'user', // Always 'user' - team access via invitations only
                displayName: user.name,
                avatarUrl: user.image ?? null,
                avatarKey: (user as Record<string, unknown>).imageKey as string | null,
                createdAt: new Date(),
              })
              console.log(`[auth] Created principal record: userId=${user.id}, role=user`)
            }
          },
        },
      },
    },

    plugins: [
      // Email OTP plugin for passwordless authentication (used by portal users)
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
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

        // Quackback-specific scopes
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
        clientRegistrationDefaultScopes: ['openid', 'profile', 'read:feedback'],

        // Additional scopes allowed for dynamically registered clients
        clientRegistrationAllowedScopes: ['offline_access', 'write:feedback', 'write:changelog'],

        // MCP endpoint is a valid token audience
        validAudiences: [`${baseURL}/api/mcp`],

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
          }
        },
      }),

      // TanStack Start cookie management plugin (must be last)
      tanstackStartCookies(),
    ],
  })
}

/**
 * Get the auth instance (lazy-initialized).
 * This allows dynamic imports of database code to prevent client bundling.
 */
export async function getAuth() {
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
    return new Proxy({} as ReturnType<typeof betterAuth>['api'], {
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
    const authInstance = await getAuth()
    return authInstance.handler(request)
  },
}

export type Auth = ReturnType<typeof betterAuth>

// Role-based access control

export type Role = 'admin' | 'member' | 'user'

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
