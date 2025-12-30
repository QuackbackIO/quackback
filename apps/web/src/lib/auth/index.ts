import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { customSession, emailOTP } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import {
  db,
  user as userTable,
  session as sessionTable,
  account as accountTable,
  verification as verificationTable,
  settings as settingsTable,
  member as memberTable,
  invitation as invitationTable,
  eq,
} from '@/lib/db'
import type { UserId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { trustLogin } from './plugins/trust-login'
import { sendSigninCodeEmail } from '@quackback/email'

/**
 * Build trusted origins for CSRF protection.
 * Accepts same-origin requests based on request host.
 */
async function getTrustedOrigins(request?: Request): Promise<string[]> {
  // During initialization, request may be undefined
  if (!request) return []

  const origin = request.headers.get('origin')
  if (!origin) return []

  try {
    const originHost = new URL(origin).host
    const requestHost = request.headers.get('host')

    // Trust if origin matches request host
    if (requestHost && originHost === requestHost) {
      return [origin]
    }
  } catch {
    return []
  }

  return []
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    // Pass our custom schema so Better-auth uses our TypeID column types
    schema: {
      user: userTable,
      session: sessionTable,
      account: accountTable,
      verification: verificationTable,
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
    // Disable cross-subdomain cookies for workspace isolation
    // Each subdomain has its own session cookie
    crossSubDomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      sameSite: 'lax',
      // Secure cookies in production
      secure: process.env.NODE_ENV === 'production',
    },
  },

  plugins: [
    // Email OTP plugin for passwordless authentication
    emailOTP({
      async sendVerificationOTP({ email, otp, type: _type }) {
        // We use the same email template for all OTP types
        await sendSigninCodeEmail({ to: email, code: otp })
      },
      otpLength: 6,
      expiresIn: 600, // 10 minutes
    }),

    // Trust login plugin for cross-domain session transfer
    trustLogin(),

    // Custom session plugin to handle avatar URL precedence:
    // 1. Uploaded avatar (imageBlob exists) -> /api/user/avatar/{userId}?v={timestamp}
    // 2. OAuth avatar (user.image URL) -> external URL
    // 3. Initials (no image) -> null
    customSession(async ({ user, session }) => {
      // Check if user has a custom uploaded avatar
      // Better-auth types user.id as string, cast to UserId for database query
      const userRecord = await db.query.user.findFirst({
        where: eq(userTable.id, user.id as UserId),
        columns: {
          imageType: true,
          updatedAt: true,
        },
      })

      // Determine the correct image URL based on precedence
      let image: string | null = null
      if (userRecord?.imageType) {
        // User has uploaded avatar - use avatar API endpoint with cache buster
        // user.id is already in TypeID format (e.g., 'user_01h...')
        const cacheBuster = userRecord.updatedAt?.getTime() ?? Date.now()
        image = `/api/user/avatar/${user.id}?v=${cacheBuster}`
      } else if (user.image) {
        // Fall back to OAuth avatar URL
        image = user.image
      }

      return {
        user: {
          ...user,
          image,
        },
        session,
      }
    }),

    // TanStack Start cookie management plugin (must be last)
    tanstackStartCookies(),
  ],
})

export type Auth = typeof auth
