import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { sso } from '@better-auth/sso'
import { db, organization as orgTable, user as userTable, eq } from '@quackback/db'
import bcrypt from 'bcryptjs'
import { trustLogin } from './plugins/trust-login'

/**
 * User metadata structure for SSO-isolated users
 */
interface SsoUserMetadata {
  realEmail: string
  ssoIsolated: true
  organizationId: string
}

/**
 * Check if a user has SSO isolation metadata
 */
function parseSsoMetadata(metadata: string | null): SsoUserMetadata | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata)
    if (parsed.ssoIsolated === true) {
      return parsed as SsoUserMetadata
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get the real email for a user (handles SSO-isolated users)
 */
export function getRealEmail(user: { email: string; metadata?: string | null }): string {
  const ssoMeta = parseSsoMetadata(user.metadata ?? null)
  return ssoMeta?.realEmail ?? user.email
}

/**
 * Check if user email is already salted (SSO-isolated)
 */
function isEmailSalted(email: string): boolean {
  return email.includes('+sso-')
}

/**
 * Generate a salted email for SSO isolation
 * Format: original@domain.com+sso-{orgId}@isolated.local
 */
function generateSaltedEmail(email: string, organizationId: string): string {
  // Create a unique, deterministic email that won't conflict
  return `${email}+sso-${organizationId}@isolated.local`
}

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
    // Disable cookie caching to allow manual session creation
    // Cookie cache stores encrypted session data which we can't manually create
    cookieCache: {
      enabled: false,
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

  // Database hooks for tenant isolation
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          return { data: user }
        },
      },
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
    // Implements "Fork, Don't Merge" for organizations with strictSsoMode enabled
    sso({
      // Disable implicit signup - require explicit approval
      disableImplicitSignUp: false,

      // Organization provisioning configuration
      organizationProvisioning: {
        disabled: false,
        defaultRole: 'member',
      },

      // provisionUser hook implements Fork-Don't-Merge logic
      // This is called AFTER user creation, so we update the user if strict mode is enabled
      provisionUser: async ({ user, userInfo: _userInfo, provider }) => {
        // Skip if user email is already salted (re-login of isolated user)
        if (isEmailSalted(user.email)) {
          return
        }

        // Check if this SSO provider is linked to an organization
        const orgId = provider.organizationId
        if (!orgId) {
          return
        }

        // Check if the organization has strict SSO mode enabled
        const org = await db.query.organization.findFirst({
          where: eq(orgTable.id, orgId),
        })

        if (!org?.strictSsoMode) {
          return
        }

        // Fork-Don't-Merge: Salt the email and store real email in metadata
        const saltedEmail = generateSaltedEmail(user.email, orgId)
        const ssoMetadata: SsoUserMetadata = {
          realEmail: user.email,
          ssoIsolated: true,
          organizationId: orgId,
        }

        // Update the user with salted email and metadata
        await db
          .update(userTable)
          .set({
            email: saltedEmail,
            metadata: JSON.stringify(ssoMetadata),
          })
          .where(eq(userTable.id, user.id))
      },
    }),
  ],
})

export type Auth = typeof auth
