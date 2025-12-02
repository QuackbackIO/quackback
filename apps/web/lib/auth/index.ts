import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { db } from '@quackback/db'

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

  // Development: support common local dev setups
  const origins = [
    'http://localhost:3000',
    'http://*.localhost:3000',
  ]

  // Add nip.io origins if configured
  if (cookieDomain?.includes('nip.io')) {
    const domain = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain
    origins.push(`http://${domain}:3000`, `http://*.${domain}:3000`)
  }

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
  ],
})

export type Auth = typeof auth
