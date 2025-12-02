import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { sso } from '@better-auth/sso'
import { db, organization as orgTable, user as userTable, eq } from '@quackback/db'

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
 */
function buildTrustedOrigins(): string[] {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const cookieDomain = process.env.COOKIE_DOMAIN

  if (process.env.NODE_ENV === 'production') {
    if (!appUrl || !cookieDomain) {
      throw new Error('NEXT_PUBLIC_APP_URL and COOKIE_DOMAIN are required in production')
    }
    // Remove leading dot from cookie domain for wildcard pattern
    const domain = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain
    return [appUrl, `https://*.${domain}`]
  }

  // Development: support quackback.localhost subdomains
  const origins = ['http://quackback.localhost:3000', 'http://*.quackback.localhost:3000']

  // Add custom app URL if set
  if (appUrl && !origins.includes(appUrl)) {
    origins.push(appUrl)
  }

  return origins
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
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
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  // Trusted origins for CSRF protection (include subdomains)
  trustedOrigins: buildTrustedOrigins(),

  advanced: {
    crossSubDomainCookies: {
      enabled: true,
      // Domain must start with dot for subdomain sharing (e.g., '.example.com')
      domain: process.env.COOKIE_DOMAIN,
    },
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },

  // Database hooks for Hub-and-Spoke identity model
  // Note: Fork-Don't-Merge SSO isolation is implemented in the SSO plugin's
  // provisionUser hook, which has access to the SSO provider context.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Log user creation for debugging
          console.log(`[Auth] Creating user: ${user.email}`)
          return { data: user }
        },
      },
    },
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: 'owner',
      memberRole: 'member',
      sendInvitationEmail: async ({ email, organization, inviter, invitation }) => {
        const { sendInvitationEmail } = await import('@quackback/email')
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        await sendInvitationEmail({
          to: email,
          invitedByEmail: inviter.user.email,
          organizationName: organization.name,
          inviteLink: `${appUrl}/accept-invitation/${invitation.id}`,
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
        console.log(`[SSO] User provisioned: ${user.email} via provider ${provider.providerId}`)

        // Skip if user email is already salted (re-login of isolated user)
        if (isEmailSalted(user.email)) {
          console.log(`[SSO] User ${user.email} is already SSO-isolated, skipping`)
          return
        }

        // Check if this SSO provider is linked to an organization
        const orgId = provider.organizationId
        if (!orgId) {
          console.log(
            `[SSO] Provider ${provider.providerId} has no organization, skipping isolation`
          )
          return
        }

        // Check if the organization has strict SSO mode enabled
        const org = await db.query.organization.findFirst({
          where: eq(orgTable.id, orgId),
        })

        if (!org?.strictSsoMode) {
          console.log(`[SSO] Organization ${orgId} does not have strict SSO mode enabled`)
          return
        }

        // Fork-Don't-Merge: Salt the email and store real email in metadata
        const saltedEmail = generateSaltedEmail(user.email, orgId)
        const ssoMetadata: SsoUserMetadata = {
          realEmail: user.email,
          ssoIsolated: true,
          organizationId: orgId,
        }

        console.log(`[SSO] Applying Fork-Don't-Merge: ${user.email} -> ${saltedEmail}`)

        // Update the user with salted email and metadata
        await db
          .update(userTable)
          .set({
            email: saltedEmail,
            metadata: JSON.stringify(ssoMetadata),
          })
          .where(eq(userTable.id, user.id))

        console.log(`[SSO] User ${user.id} email isolated for org ${orgId}`)
      },
    }),
  ],
})

export type Auth = typeof auth
