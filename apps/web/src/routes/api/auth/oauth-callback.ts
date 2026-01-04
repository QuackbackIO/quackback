import { createFileRoute } from '@tanstack/react-router'
import { generateId, type UserId } from '@quackback/ids'

/**
 * OAuth Callback Handler (OSS Edition)
 *
 * Handles OAuth callbacks from GitHub and Google. For single workspace OSS deployments,
 * this creates the user directly and establishes a session without domain transfers.
 *
 * Flow:
 * 1. Parse and verify OAuth state
 * 2. Exchange code for access token
 * 3. Get user info from provider
 * 4. Find or create user + member record
 * 5. Create session and set cookie
 * 6. Redirect to callback URL
 */

interface OAuthState {
  workspace: string
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

function buildCallbackUrl(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  const host = request.headers.get('host')
  return `${proto}://${host}/api/auth/oauth-callback`
}

async function exchangeCodeForToken(
  provider: string,
  code: string,
  redirectUri: string
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
        redirect_uri: redirectUri,
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
        redirect_uri: redirectUri,
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

function buildErrorRedirect(callbackUrl: string, error: string): string {
  return `${callbackUrl}?error=${encodeURIComponent(error)}`
}

export const Route = createFileRoute('/api/auth/oauth-callback')({
  server: {
    handlers: {
      /**
       * GET /api/auth/oauth-callback
       * OAuth callback handler for GitHub and Google
       */
      GET: async ({ request }) => {
        const { db, settings, user, account, member, session, eq, and } = await import('@/lib/db')
        const { verifyOAuthState } = await import('@/lib/auth/oauth-state')

        const url = new URL(request.url)
        const searchParams = url.searchParams
        const code = searchParams.get('code')
        const stateParam = searchParams.get('state')
        const error = searchParams.get('error')

        // Handle OAuth errors from provider
        if (error) {
          console.error('OAuth error from provider:', error, searchParams.get('error_description'))
          // Can't redirect without state, just show error
          return Response.json({ error: `OAuth error: ${error}` }, { status: 400 })
        }

        if (!code || !stateParam) {
          return Response.json({ error: 'Missing code or state' }, { status: 400 })
        }

        // Parse state: "provider:signedState"
        const colonIndex = stateParam.indexOf(':')
        if (colonIndex === -1) {
          return Response.json({ error: 'Invalid state format' }, { status: 400 })
        }

        const provider = stateParam.substring(0, colonIndex)
        const signedState = stateParam.substring(colonIndex + 1)

        // Verify HMAC signature and decode state
        const state = verifyOAuthState<OAuthState>(signedState)
        if (!state) {
          console.error('OAuth state signature verification failed')
          return Response.json({ error: 'Invalid or tampered state' }, { status: 400 })
        }

        // Validate state timestamp (5 minute expiry)
        if (Date.now() - state.ts > 5 * 60 * 1000) {
          return Response.redirect(buildErrorRedirect(state.callbackUrl, 'auth_expired'), 302)
        }

        // Validate settings exists (OSS mode: single workspace)
        const org = await db.query.settings.findFirst({
          where: eq(settings.slug, state.workspace),
        })

        if (!org) {
          return Response.redirect(buildErrorRedirect(state.callbackUrl, 'settings_not_found'), 302)
        }

        // Exchange code for token
        const redirectUri = buildCallbackUrl(request)
        const tokenResult = await exchangeCodeForToken(provider, code, redirectUri)
        if ('error' in tokenResult) {
          console.error('Token exchange error:', tokenResult.error)
          return Response.redirect(
            buildErrorRedirect(state.callbackUrl, 'token_exchange_failed'),
            302
          )
        }

        // Get user info
        const userInfoResult = await getUserInfo(provider, tokenResult.accessToken)
        if ('error' in userInfoResult) {
          console.error('User info error:', userInfoResult.error)
          return Response.redirect(buildErrorRedirect(state.callbackUrl, 'user_info_failed'), 302)
        }

        const { email, name, image, providerId, providerAccountId } = userInfoResult

        try {
          // Check if user already exists by email (OSS: no workspace scoping needed)
          const existingUser = await db.query.user.findFirst({
            where: eq(user.email, email),
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
              // Create user (no workspaceId - removed for OSS)
              await tx.insert(user).values({
                id: userId,
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
                role: memberRole,
                createdAt: new Date(),
              })
            })
          }

          // Create session directly (OSS: no transfer token needed)
          // Better-auth uses crypto.randomUUID() for session IDs
          const sessionId = crypto.randomUUID()
          const sessionToken = crypto.randomUUID()
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

          await db.insert(session).values({
            id: sessionId,
            userId,
            token: sessionToken,
            expiresAt,
            ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
            userAgent: request.headers.get('user-agent'),
            createdAt: new Date(),
            updatedAt: new Date(),
          })

          // Set session cookie
          const response = Response.redirect(
            new URL(state.callbackUrl, request.url).toString(),
            302
          )
          const isSecure = request.headers.get('x-forwarded-proto') === 'https'

          response.headers.append(
            'Set-Cookie',
            `better-auth.session_token=${sessionToken}; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}; Path=/`
          )

          return response
        } catch (error) {
          console.error('OAuth callback error:', error)
          return Response.redirect(buildErrorRedirect(state.callbackUrl, 'signup_failed'), 302)
        }
      },
    },
  },
})
