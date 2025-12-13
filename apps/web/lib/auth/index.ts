import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { sso } from '@better-auth/sso'
import { db, workspaceDomain, eq, and } from '@quackback/db'
import { trustLogin } from './plugins/trust-login'

/**
 * Build trusted origins dynamically for CSRF protection.
 *
 * Trusted origins include:
 * 1. Main app domain and all subdomains (e.g., *.quackback.io)
 * 2. Verified custom domains from the workspace_domain table
 *
 * Returns the origin if trusted, empty array if not.
 */
async function getTrustedOrigins(request: Request): Promise<string[]> {
  const origin = request.headers.get('origin')
  if (!origin) return []

  // Parse the origin to extract the hostname
  let originHost: string
  try {
    originHost = new URL(origin).hostname
  } catch {
    return []
  }

  const appDomain = process.env.APP_DOMAIN

  // Development fallback
  if (!appDomain) {
    if (originHost === 'localhost' || originHost.endsWith('.localhost')) {
      return [origin]
    }
    return []
  }

  // Check if origin matches main domain or any subdomain
  if (originHost === appDomain || originHost.endsWith(`.${appDomain}`)) {
    return [origin]
  }

  // Check if origin is a verified custom domain
  const customDomain = await db.query.workspaceDomain.findFirst({
    where: and(
      eq(workspaceDomain.domain, originHost),
      eq(workspaceDomain.domainType, 'custom'),
      eq(workspaceDomain.verified, true)
    ),
    columns: { id: true },
  })

  return customDomain ? [origin] : []
}

/**
 * Build the base URL for Better-Auth
 * Uses APP_DOMAIN env var with appropriate protocol
 */
function buildBaseURL(): string | undefined {
  const domain = process.env.APP_DOMAIN
  if (!domain) return undefined

  const isLocalhost = domain.includes('localhost')
  const protocol = isLocalhost ? 'http' : 'https'
  return `${protocol}://${domain}`
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),

  // Base URL for OAuth callbacks when running behind a proxy (e.g., ngrok)
  baseURL: buildBaseURL(),

  // Password auth disabled - users sign in via OTP email codes
  emailAndPassword: {
    enabled: false,
  },

  // Include organizationId in user object for tenant validation
  // This enables the proxy to verify the session belongs to the correct tenant
  user: {
    additionalFields: {
      organizationId: {
        type: 'string',
        required: true,
      },
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

  // Trusted origins for CSRF protection
  // Dynamically checks main domain, subdomains, and verified custom domains
  trustedOrigins: getTrustedOrigins,

  advanced: {
    // Disable cross-subdomain cookies for tenant isolation
    // Each subdomain has its own session cookie
    crossSubDomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      sameSite: 'lax',
      // Secure cookies for HTTPS (production or ngrok)
      secure: !process.env.APP_DOMAIN?.includes('localhost'),
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
        const isLocalhost = domain.includes('localhost')
        const protocol = isLocalhost ? 'http' : 'https'
        const inviteLink = `${protocol}://${organization.slug}.${domain}/accept-invitation/${invitation.id}`
        await sendInvitationEmail({
          to: email,
          invitedByName: inviter.user.name,
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
