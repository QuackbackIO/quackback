import { NextRequest, NextResponse } from 'next/server'
import {
  db,
  organization,
  user,
  account,
  member,
  sessionTransferToken,
  workspaceDomain,
  eq,
  and,
} from '@/lib/db'
import { verifyOAuthState } from '@/lib/auth/oauth-state'
import { generateId, type UserId } from '@quackback/ids'

/**
 * OAuth Callback Handler
 *
 * Handles OAuth callbacks from GitHub and Google. This route runs on the main
 * domain and creates org-scoped users, then redirects to the tenant domain
 * with a session transfer token.
 *
 * Flow:
 * 1. Parse state to get provider, org, returnDomain
 * 2. Exchange code for access token
 * 3. Get user info from provider
 * 4. Find or create org-scoped user
 * 5. Create session transfer token
 * 6. Redirect to returnDomain/api/auth/trust-login?token=xxx
 */

interface OAuthState {
  org: string
  returnDomain: string
  context: 'team' | 'portal'
  callbackUrl: string
  popup: boolean
  ts: number
}

interface OAuthUserInfo {
  email: string
  name: string
  image?: string
  providerId: string
  providerAccountId: string
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function getProtocol(): string {
  const domain = process.env.APP_DOMAIN
  return domain?.includes('localhost') ? 'http' : 'https'
}

function buildCallbackUrl(): string {
  const domain = process.env.APP_DOMAIN
  if (!domain) throw new Error('APP_DOMAIN is required')
  return `${getProtocol()}://${domain}/api/auth/oauth-callback`
}

async function exchangeCodeForToken(
  provider: string,
  code: string
): Promise<{ accessToken: string } | { error: string }> {
  if (provider === 'github') {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: buildCallbackUrl(),
      }),
    })

    const data = (await response.json()) as {
      error?: string
      error_description?: string
      access_token?: string
    }

    if (data.error) {
      return { error: data.error_description || data.error }
    }
    if (!data.access_token) {
      return { error: 'No access token received from GitHub' }
    }
    return { accessToken: data.access_token }
  }

  if (provider === 'google') {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        code,
        redirect_uri: buildCallbackUrl(),
        grant_type: 'authorization_code',
      }),
    })

    const data = (await response.json()) as {
      error?: string
      error_description?: string
      access_token?: string
    }
    if (data.error) {
      return { error: data.error_description || data.error }
    }
    if (!data.access_token) {
      return { error: 'No access token received from Google' }
    }
    return { accessToken: data.access_token }
  }

  return { error: 'Unsupported provider' }
}

async function getUserInfo(
  provider: string,
  accessToken: string
): Promise<OAuthUserInfo | { error: string }> {
  if (provider === 'github') {
    // Get user profile
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Quackback',
      },
    })

    if (!userResponse.ok) {
      return { error: 'Failed to get user info from GitHub' }
    }

    const userData = (await userResponse.json()) as {
      email?: string
      name?: string
      login: string
      avatar_url: string
      id: number
    }

    // Get primary email (may not be in profile)
    let email = userData.email
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Quackback',
        },
      })

      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{
          email: string
          primary: boolean
          verified: boolean
        }>
        const primaryEmail = emails.find((e) => e.primary && e.verified)
        email = primaryEmail?.email || emails[0]?.email
      }
    }

    if (!email) {
      return {
        error: 'Could not get email from GitHub. Please ensure your email is public or verified.',
      }
    }

    return {
      email: email.toLowerCase(),
      name: userData.name || userData.login,
      image: userData.avatar_url,
      providerId: 'github',
      providerAccountId: String(userData.id),
    }
  }

  if (provider === 'google') {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      return { error: 'Failed to get user info from Google' }
    }

    const userData = (await response.json()) as {
      email?: string
      name?: string
      picture?: string
      id: string
    }

    if (!userData.email) {
      return { error: 'Could not get email from Google' }
    }

    return {
      email: userData.email.toLowerCase(),
      name: userData.name || userData.email.split('@')[0],
      image: userData.picture,
      providerId: 'google',
      providerAccountId: userData.id,
    }
  }

  return { error: 'Unsupported provider' }
}

function buildErrorRedirect(returnDomain: string, error: string): string {
  const protocol = getProtocol()
  return `${protocol}://${returnDomain}/login?error=${encodeURIComponent(error)}`
}

/**
 * Validate that the return domain is allowed by checking workspace_domain table.
 * This is more flexible than suffix-based validation and handles both
 * subdomain and custom domain types.
 */
async function isValidReturnDomain(domain: string): Promise<boolean> {
  const domainRecord = await db.query.workspaceDomain.findFirst({
    where: and(eq(workspaceDomain.domain, domain), eq(workspaceDomain.verified, true)),
  })

  return !!domainRecord
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const error = searchParams.get('error')

  // Handle OAuth errors from provider
  if (error) {
    console.error('OAuth error from provider:', error, searchParams.get('error_description'))
    // Can't redirect without state, just show error
    return NextResponse.json({ error: `OAuth error: ${error}` }, { status: 400 })
  }

  if (!code || !stateParam) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }

  // Parse state: "provider:signedState"
  const colonIndex = stateParam.indexOf(':')
  if (colonIndex === -1) {
    return NextResponse.json({ error: 'Invalid state format' }, { status: 400 })
  }

  const provider = stateParam.substring(0, colonIndex)
  const signedState = stateParam.substring(colonIndex + 1)

  // Verify HMAC signature and decode state
  const state = verifyOAuthState<OAuthState>(signedState)
  if (!state) {
    console.error('OAuth state signature verification failed')
    return NextResponse.json({ error: 'Invalid or tampered state' }, { status: 400 })
  }

  // Validate state timestamp (5 minute expiry)
  if (Date.now() - state.ts > 5 * 60 * 1000) {
    return NextResponse.redirect(buildErrorRedirect(state.returnDomain, 'auth_expired'))
  }

  // Validate org exists
  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, state.org),
  })

  if (!org) {
    return NextResponse.redirect(buildErrorRedirect(state.returnDomain, 'org_not_found'))
  }

  // Validate return domain is allowed (subdomain of APP_DOMAIN or verified custom domain)
  const validDomain = await isValidReturnDomain(state.returnDomain)
  if (!validDomain) {
    console.error('Invalid return domain:', state.returnDomain)
    return NextResponse.json({ error: 'Invalid return domain' }, { status: 400 })
  }

  // Exchange code for token
  const tokenResult = await exchangeCodeForToken(provider, code)
  if ('error' in tokenResult) {
    console.error('Token exchange error:', tokenResult.error)
    return NextResponse.redirect(buildErrorRedirect(state.returnDomain, 'token_exchange_failed'))
  }

  // Get user info
  const userInfoResult = await getUserInfo(provider, tokenResult.accessToken)
  if ('error' in userInfoResult) {
    console.error('User info error:', userInfoResult.error)
    return NextResponse.redirect(buildErrorRedirect(state.returnDomain, 'user_info_failed'))
  }

  const { email, name, image, providerId, providerAccountId } = userInfoResult

  try {
    // Check if user already exists in this org
    const existingUser = await db.query.user.findFirst({
      where: and(eq(user.email, email), eq(user.organizationId, org.id)),
    })

    let userId: UserId

    if (existingUser) {
      // User exists - check if this OAuth account is linked
      userId = existingUser.id

      const existingAccount = await db.query.account.findFirst({
        where: and(
          eq(account.userId, userId),
          eq(account.providerId, providerId),
          eq(account.accountId, providerAccountId)
        ),
      })

      if (!existingAccount) {
        // Link this OAuth account to existing user
        await db.insert(account).values({
          id: generateId('account'),
          userId,
          accountId: providerAccountId,
          providerId,
          accessToken: tokenResult.accessToken,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      } else {
        // Update access token
        await db
          .update(account)
          .set({ accessToken: tokenResult.accessToken, updatedAt: new Date() })
          .where(eq(account.id, existingAccount.id))
      }
    } else {
      // Create new user
      userId = generateId('user')
      const memberId = generateId('member')
      const accountId = generateId('account')

      // Determine role based on context
      const memberRole = state.context === 'team' ? 'member' : 'user'

      await db.transaction(async (tx) => {
        // Create user
        await tx.insert(user).values({
          id: userId,
          organizationId: org.id,
          name,
          email,
          emailVerified: true, // OAuth emails are verified
          image,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Create OAuth account
        await tx.insert(account).values({
          id: accountId,
          userId,
          accountId: providerAccountId,
          providerId,
          accessToken: tokenResult.accessToken,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Create member record
        await tx.insert(member).values({
          id: memberId,
          userId,
          organizationId: org.id,
          role: memberRole,
          createdAt: new Date(),
        })
      })
    }

    // Create session transfer token
    const transferTokenId = generateId('transfer_token')
    const transferToken = generateSecureToken()

    await db.insert(sessionTransferToken).values({
      id: transferTokenId,
      token: transferToken,
      userId,
      targetDomain: state.returnDomain,
      callbackUrl: state.callbackUrl,
      context: state.context,
      expiresAt: new Date(Date.now() + 30000), // 30 seconds
      createdAt: new Date(),
    })

    // Redirect to tenant domain with transfer token
    const protocol = getProtocol()
    let redirectUrl = `${protocol}://${state.returnDomain}/api/auth/trust-login?token=${transferToken}`

    // Pass popup param if this was initiated from a popup window
    if (state.popup) {
      redirectUrl += '&popup=true'
    }

    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error('OAuth callback error:', error)
    return NextResponse.redirect(buildErrorRedirect(state.returnDomain, 'signup_failed'))
  }
}
