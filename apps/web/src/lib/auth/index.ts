import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, oneTimeToken, magicLink } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { generateId } from '@quackback/ids'

// ============================================================================
// Magic Link Token Capture
// ============================================================================

/**
 * Temporary storage for magic link tokens during invitation flow.
 * When sendInvitationFn calls signInMagicLink, the callback stores the token here.
 * The invitation flow then retrieves it to construct the URL with the correct workspace domain.
 */
const pendingMagicLinkTokens = new Map<string, { token: string; timestamp: number }>()

/**
 * Store a magic link token for retrieval by the invitation flow.
 * Tokens are automatically cleaned up after 30 seconds.
 */
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

/**
 * Retrieve and remove a stored magic link token.
 * Returns undefined if no token is stored for this email.
 */
export function getMagicLinkToken(email: string): string | undefined {
  const normalizedEmail = email.toLowerCase()
  const stored = pendingMagicLinkTokens.get(normalizedEmail)
  if (stored) {
    pendingMagicLinkTokens.delete(normalizedEmail)
    return stored.token
  }
  return undefined
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

/**
 * Build trusted origins for CSRF protection.
 * Accepts same-origin requests and allows redirects to the request host.
 */
async function getTrustedOrigins(request?: Request): Promise<string[]> {
  // During initialization, request may be undefined
  if (!request) return []

  const trusted: string[] = []
  const requestHost = request.headers.get('host')

  // Always trust the request host (for GET requests like magic link clicks that don't have Origin header)
  if (requestHost) {
    // Determine protocol from request URL or default to https
    const protocol = new URL(request.url).protocol || 'https:'
    trusted.push(`${protocol}//${requestHost}`)
  }

  // Also trust if Origin header matches request host
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      const originHost = new URL(origin).host
      if (requestHost && originHost === requestHost) {
        trusted.push(origin)
      }
    } catch {
      // Invalid origin header, ignore
    }
  }

  return [...new Set(trusted)] // Deduplicate
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
  } = await import('@/lib/db')
  const { sendSigninCodeEmail } = await import('@quackback/email')

  // Get cloud-only plugins
  const sessionTransferPlugin = await getSessionTransferPlugin()

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

      // Session transfer for cross-domain handoff from website (cloud only)
      ...(sessionTransferPlugin ? [sessionTransferPlugin] : []),

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
