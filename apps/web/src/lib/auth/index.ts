import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, oneTimeToken, magicLink } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { generateId } from '@quackback/ids'

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

// Build-time constants (defined in vite.config.ts)
declare const __EDITION__: 'cloud' | 'self-hosted'

// Conditionally import session-transfer only for cloud edition
// This allows tree-shaking for self-hosted builds
const getSessionTransferPlugin = async (): Promise<BetterAuthPlugin | null> => {
  if (__EDITION__ !== 'cloud') return null
  const { sessionTransfer } = await import('./plugins/session-transfer')
  return sessionTransfer()
}

// OAuth callback plugin for GitHub/Google/OIDC
// Handles OAuth callbacks and transfers session to tenant domain
const getOAuthCallbackPlugin = async (): Promise<BetterAuthPlugin> => {
  const { oauthCallback } = await import('./plugins/oauth-callback')
  return oauthCallback()
}

// OAuth complete plugin - completes OAuth on tenant domain after app domain callback
const getOAuthCompletePlugin = async (): Promise<BetterAuthPlugin> => {
  const { oauthComplete } = await import('./plugins/oauth-complete')
  return oauthComplete()
}

async function getTrustedOrigins(request?: Request): Promise<string[]> {
  if (!request) return []

  const trusted: string[] = []
  const requestHost = request.headers.get('host')

  // Trust the request host (for GET requests like magic link clicks without Origin header)
  if (requestHost) {
    const protocol = new URL(request.url).protocol || 'https:'
    trusted.push(`${protocol}//${requestHost}`)
  }

  // Trust Origin header if it matches request host
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      if (requestHost && new URL(origin).host === requestHost) {
        trusted.push(origin)
      }
    } catch {
      // Invalid origin header, ignore
    }
  }

  return [...new Set(trusted)]
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
    member: memberTable,
    invitation: invitationTable,
    eq,
  } = await import('@/lib/db')
  const { sendSigninCodeEmail } = await import('@quackback/email')

  // Get plugins
  const sessionTransferPlugin = await getSessionTransferPlugin()
  const oauthCallbackPlugin = await getOAuthCallbackPlugin()
  const oauthCompletePlugin = await getOAuthCompletePlugin()

  return betterAuth({
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
        member: memberTable,
        invitation: invitationTable,
      },
    }),

    // Base URL derived from request (no hardcoded URL needed)
    baseURL: process.env.BETTER_AUTH_URL,

    // Password auth disabled - users sign in via OTP email codes
    emailAndPassword: {
      enabled: false,
    },

    // Account linking - allow users to link multiple OAuth providers to their account
    // This is needed when a user signs up with email OTP, then later signs in with GitHub/Google
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['github', 'google', 'oidc', 'team-sso'],
      },
    },

    // Note: GitHub/Google OAuth is handled by our custom oauth-callback plugin
    // instead of Better Auth's built-in socialProviders. This allows callbacks
    // on the app domain with session transfer to tenant domains.

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      // Cookie caching disabled - causes issues with manual session creation
      // during onboarding. TODO: Re-enable once onboarding uses proper auth flow.
      // cookieCache: {
      //   enabled: true,
      //   maxAge: 60 * 5, // 5 minutes - re-validate from DB periodically
      //   encoding: 'jwt', // JWT encoding allows signature verification without DB
      // },
    },

    // Trusted origins for CSRF protection
    // Dynamically checks main domain, subdomains, and verified custom domains
    trustedOrigins: getTrustedOrigins,

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
        // Secure cookies in production
        secure: (process.env.NODE_ENV as string) === 'production',
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
            const existingMember = await db.query.member.findFirst({
              where: eq(memberTable.userId, userId),
            })

            if (!existingMember) {
              await db.insert(memberTable).values({
                id: generateId('member'),
                userId,
                role: 'user', // Always 'user' - team access via invitations only
                createdAt: new Date(),
              })
              console.log(`[auth] Created member record: userId=${user.id}, role=user`)
            }
          },
        },
      },
    },

    plugins: [
      // Email OTP plugin for passwordless authentication (used by portal users)
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          console.log(`[auth] sendVerificationOTP called for ${email}, type: ${type}`)
          try {
            await sendSigninCodeEmail({ to: email, code: otp })
            console.log(`[auth] OTP email sent successfully to ${email}`)
          } catch (error) {
            console.error(`[auth] Failed to send OTP email to ${email}:`, error)
            throw error
          }
        },
        otpLength: 6,
        expiresIn: 600, // 10 minutes
      }),

      // Magic link plugin for team member invitations
      // When invitations are sent, the sendMagicLink callback stores the token
      // which is then retrieved by sendInvitationFn to build the URL with correct workspace domain
      magicLink({
        async sendMagicLink({ email, token, url }) {
          console.log(`[auth] sendMagicLink callback:`)
          console.log(`[auth]   email: ${email}`)
          console.log(`[auth]   token length: ${token?.length}`)
          console.log(`[auth]   url (from Better Auth): ${url}`)
          // Store only the token - we'll construct the URL with the workspace domain
          storeMagicLinkToken(email, token)
          console.log(`[auth]   token stored in pending map`)
        },
        expiresIn: 60 * 60 * 24 * 7, // 7 days - match invitation expiry
        disableSignUp: false, // Allow new users to sign up via invitation
      }),

      // One-time token plugin for cross-domain session transfer (used by /get-started)
      oneTimeToken({
        expiresIn: 60, // 1 minute - tokens are used immediately after generation
      }),

      // Session transfer for post-provisioning auth from website (cloud only)
      ...(sessionTransferPlugin ? [sessionTransferPlugin] : []),

      // OAuth callback for GitHub/Google/OIDC - handles callbacks and session transfer
      oauthCallbackPlugin,

      // OAuth complete - completes OAuth on tenant domain after app domain callback
      oauthCompletePlugin,

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
