import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { sso } from '@better-auth/sso'
import { db } from '@quackback/db'
import bcrypt from 'bcryptjs'
import { trustLogin } from './plugins/trust-login'

/**
 * Build trusted origins list for CSRF protection
 * Supports wildcards for subdomains
 *
 * Uses APP_DOMAIN env var (e.g., "quackback.io" or "localhost:3000")
 */
function buildTrustedOrigins(): string[] {
  const domain = process.env.APP_DOMAIN

  // During build time, APP_DOMAIN may not be set - use a placeholder
  // that will be replaced at runtime
  if (!domain) {
    // Allow build to proceed but require APP_DOMAIN at runtime
    // This is safe because trustedOrigins is checked per-request
    return ['http://localhost:3000', 'http://*.localhost:3000']
  }

  // Use https in production, http for localhost
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  return [`${protocol}://${domain}`, `${protocol}://*.${domain}`]
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    // Use bcrypt for password hashing (compatible with bcryptjs and Bun.password)
    password: {
      hash: async (password: string) => bcrypt.hash(password, 10),
      verify: async ({ password, hash }: { password: string; hash: string }) =>
        bcrypt.compare(password, hash),
    },
  },

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      enabled: !!process.env.GITHUB_CLIENT_ID,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      enabled: !!process.env.GOOGLE_CLIENT_ID,
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      enabled: !!process.env.MICROSOFT_CLIENT_ID,
      // Use 'common' tenant for multi-tenant apps (personal + work/school accounts)
      // Change to 'organizations' for work/school only, or specific tenant ID
      tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    // Enable cookie caching with JWT encoding for stateless session validation
    // This allows the proxy to validate sessions without DB queries
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes - re-validate from DB periodically
      encoding: 'jwt', // JWT encoding allows signature verification without DB
    },
  },

  // Trusted origins for CSRF protection (include subdomains)
  trustedOrigins: buildTrustedOrigins(),

  advanced: {
    // Disable cross-subdomain cookies for tenant isolation
    // Each subdomain has its own session cookie
    crossSubDomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },

  plugins: [
    // Trust login plugin for cross-domain session transfer
    trustLogin(),

    organization({
      // Tenant creation is handled by create-workspace flow, not direct API
      allowUserToCreateOrganization: false,
      creatorRole: 'owner',
      memberRole: 'member',
      sendInvitationEmail: async ({ email, organization, inviter, invitation }) => {
        const { sendInvitationEmail } = await import('@quackback/email')
        // Build the subdomain URL for the org
        const domain = process.env.APP_DOMAIN
        if (!domain) {
          throw new Error('APP_DOMAIN environment variable is required')
        }
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
        const inviteLink = `${protocol}://${organization.slug}.${domain}/accept-invitation/${invitation.id}`
        await sendInvitationEmail({
          to: email,
          invitedByEmail: inviter.user.email,
          organizationName: organization.name,
          inviteLink,
        })
      },
    }),

    // SSO plugin for enterprise SAML/OIDC authentication
    // Uses automatic email-based account linking (no email salting)
    sso({
      disableImplicitSignUp: false,

      // Organization provisioning: automatically add SSO users to the org
      organizationProvisioning: {
        disabled: false,
        defaultRole: 'member',
      },
    }),
  ],
})

export type Auth = typeof auth
