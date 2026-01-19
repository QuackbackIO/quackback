/**
 * OIDC Callback Plugin for Better-Auth
 *
 * Handles callbacks from tenant-configured OIDC providers. Unlike GitHub/Google
 * which use Better Auth's built-in socialProviders, OIDC requires custom handling
 * because the configuration is dynamic (loaded from database per tenant).
 *
 * This is implemented as a Better Auth plugin to properly integrate with
 * tanstackStartCookies() for session cookie handling.
 *
 * Flow:
 * 1. Verify HMAC-signed state parameter
 * 2. Load OIDC config from tenant settings
 * 3. Exchange authorization code for tokens
 * 4. Get user info from OIDC userinfo endpoint
 * 5. Create/find user and member records
 * 6. Create session and set cookie using ctx.setCookie() for proper tanstackStartCookies integration
 * 7. Redirect to callback URL
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { z } from 'zod'
import { generateId, type UserId } from '@quackback/ids'

interface OAuthState {
  workspace: string
  returnDomain: string
  callbackUrl: string
  popup: boolean
  type: 'portal' | 'team'
  ts: number
}

function buildCallbackUrl(headers: Headers): string {
  const proto = headers.get('x-forwarded-proto') || 'http'
  const host = headers.get('host')
  return `${proto}://${host}/api/auth/callback/oidc`
}

function buildErrorRedirect(baseUrl: string, callbackUrl: string, error: string): string {
  const url = new URL(callbackUrl, baseUrl)
  url.searchParams.set('error', error)
  return url.toString()
}

export const oidcCallback = () => {
  return {
    id: 'oidc-callback',
    endpoints: {
      oidcCallback: createAuthEndpoint(
        '/callback/oidc',
        {
          method: 'GET',
          query: z.object({
            code: z.string().optional(),
            state: z.string().optional(),
            error: z.string().optional(),
            error_description: z.string().optional(),
          }),
        },
        async (ctx) => {
          const { db, settings, user, account, member, eq, and } = await import('@/lib/db')
          const { verifyOAuthState } = await import('@/lib/auth/oauth-state')
          const { getFullOIDCConfig } = await import('@/lib/settings/settings.service')
          const { exchangeOIDCCode, getOIDCUserInfo } = await import('@/lib/auth/oidc.service')

          const { code, state: stateParam, error, error_description } = ctx.query
          const requestUrl = ctx.headers?.get('x-forwarded-proto')
            ? `${ctx.headers.get('x-forwarded-proto')}://${ctx.headers.get('host')}${ctx.request?.url ? new URL(ctx.request.url).pathname : '/api/auth/callback/oidc'}`
            : ctx.request?.url || ''

          // Handle OAuth errors from provider
          if (error) {
            console.error(`[oidc-callback] Provider error: ${error}`, error_description)
            return ctx.json({ error: `OAuth error: ${error}` }, { status: 400 })
          }

          if (!code || !stateParam) {
            return ctx.json({ error: 'Missing code or state' }, { status: 400 })
          }

          // Parse state: "oidc:signedState"
          if (!stateParam.startsWith('oidc:')) {
            return ctx.json({ error: 'Invalid state format' }, { status: 400 })
          }
          const signedState = stateParam.slice(5)

          // Verify HMAC signature and decode state
          const state = verifyOAuthState<OAuthState>(signedState)
          if (!state) {
            console.error(`[oidc-callback] State signature verification failed`)
            return ctx.json({ error: 'Invalid or tampered state' }, { status: 400 })
          }

          // Validate state timestamp (5 minute expiry)
          if (Date.now() - state.ts > 5 * 60 * 1000) {
            return ctx.redirect(buildErrorRedirect(requestUrl, state.callbackUrl, 'auth_expired'))
          }

          // Validate settings exists
          const org = await db.query.settings.findFirst({
            where: eq(settings.slug, state.workspace),
          })

          if (!org) {
            return ctx.redirect(
              buildErrorRedirect(requestUrl, state.callbackUrl, 'settings_not_found')
            )
          }

          // Load OIDC config from database (portal or team based on type)
          const { getFullSecurityConfig } = await import('@/lib/settings/settings.service')
          const oidcType = state.type || 'portal'

          let oidcConfig
          if (oidcType === 'team') {
            // Team SSO - load from security config
            const securityConfig = await getFullSecurityConfig()
            if (!securityConfig?.sso.enabled || !securityConfig.sso.provider) {
              return ctx.redirect(
                buildErrorRedirect(requestUrl, state.callbackUrl, 'oidc_not_configured')
              )
            }
            oidcConfig = securityConfig.sso.provider
          } else {
            // Portal OIDC - load from portal config
            oidcConfig = await getFullOIDCConfig()
            if (!oidcConfig?.enabled) {
              return ctx.redirect(
                buildErrorRedirect(requestUrl, state.callbackUrl, 'oidc_not_configured')
              )
            }
          }

          // Exchange code for tokens
          const redirectUri = buildCallbackUrl(ctx.headers!)
          const tokens = await exchangeOIDCCode(oidcConfig, code, redirectUri, org.id)
          if ('error' in tokens) {
            console.error(`[oidc-callback] Token exchange failed:`, tokens.error)
            return ctx.redirect(
              buildErrorRedirect(requestUrl, state.callbackUrl, 'token_exchange_failed')
            )
          }

          // Get user info from OIDC userinfo endpoint
          const userInfoResult = await getOIDCUserInfo(oidcConfig, tokens.accessToken)
          if ('error' in userInfoResult) {
            console.error(`[oidc-callback] Userinfo failed:`, userInfoResult.error)
            return ctx.redirect(
              buildErrorRedirect(requestUrl, state.callbackUrl, 'user_info_failed')
            )
          }

          // Validate email domain if configured
          if (oidcConfig.emailDomain) {
            const emailDomain = userInfoResult.email.split('@')[1]
            if (emailDomain !== oidcConfig.emailDomain) {
              console.error(`[oidc-callback] Email domain mismatch: ${emailDomain}`)
              return ctx.redirect(
                buildErrorRedirect(requestUrl, state.callbackUrl, 'email_domain_mismatch')
              )
            }
          }

          const { sub, email, name, picture } = userInfoResult

          try {
            // Check if user already exists by email
            const existingUser = await db.query.user.findFirst({
              where: eq(user.email, email),
            })

            let userId: UserId

            if (existingUser) {
              // User exists - check if this OIDC account is linked
              userId = existingUser.id

              // For team SSO, verify user is a team member (not just a portal user)
              if (oidcType === 'team') {
                const existingMember = await db.query.member.findFirst({
                  where: eq(member.userId, userId),
                })

                // Team members have role 'admin' or 'member', portal users have 'user'
                if (!existingMember || existingMember.role === 'user') {
                  console.error(
                    `[oidc-callback] Team SSO rejected: user ${userId} is not a team member`
                  )
                  return ctx.redirect(
                    buildErrorRedirect(requestUrl, state.callbackUrl, 'not_team_member')
                  )
                }
              }

              const existingAccount = await db.query.account.findFirst({
                where: and(
                  eq(account.userId, userId),
                  eq(account.providerId, oidcType === 'team' ? 'team-sso' : 'oidc'),
                  eq(account.accountId, sub)
                ),
              })

              if (!existingAccount) {
                // Link OIDC account to existing user
                await db.insert(account).values({
                  id: generateId('account'),
                  userId,
                  accountId: sub,
                  providerId: oidcType === 'team' ? 'team-sso' : 'oidc',
                  accessToken: tokens.accessToken,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })
              } else {
                // Update access token
                await db
                  .update(account)
                  .set({ accessToken: tokens.accessToken, updatedAt: new Date() })
                  .where(eq(account.id, existingAccount.id))
              }
            } else {
              // For team SSO, user must already exist (team membership is by invitation only)
              if (oidcType === 'team') {
                console.error(`[oidc-callback] Team SSO rejected: user does not exist`)
                return ctx.redirect(
                  buildErrorRedirect(requestUrl, state.callbackUrl, 'not_team_member')
                )
              }

              // Create new user (portal OIDC only)
              // All OAuth signups get 'user' role - team access via invitations only
              userId = generateId('user')
              const memberId = generateId('member')
              const accountId = generateId('account')

              await db.transaction(async (tx) => {
                await tx.insert(user).values({
                  id: userId,
                  name,
                  email,
                  emailVerified: true,
                  image: picture,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })

                await tx.insert(account).values({
                  id: accountId,
                  userId,
                  accountId: sub,
                  providerId: 'oidc',
                  accessToken: tokens.accessToken,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })

                await tx.insert(member).values({
                  id: memberId,
                  userId,
                  role: 'user', // Always 'user' - team access via invitations only
                  createdAt: new Date(),
                })
              })
            }

            // Create session using Better Auth's internal adapter

            // internalAdapter.createSession(userId, dontRememberMe?)
            const newSession = await ctx.context.internalAdapter.createSession(
              userId,
              false // dontRememberMe
            )

            if (!newSession) {
              console.error(`[oidc-callback] Failed to create session via internalAdapter`)
              return ctx.redirect(
                buildErrorRedirect(requestUrl, state.callbackUrl, 'session_failed')
              )
            }

            // Set session cookie using Better Auth's SIGNED cookie handling
            // IMPORTANT: Must use setSignedCookie (not setCookie) for HMAC signing
            // Better Auth validates session cookies by verifying the signature
            const authCookie = ctx.context.createAuthCookie('session_token')
            await ctx.setSignedCookie(
              authCookie.name,
              newSession.token,
              ctx.context.secret,
              authCookie.attributes
            )
            return ctx.redirect(state.callbackUrl)
          } catch (err) {
            console.error(`[oidc-callback] Error:`, err)
            return ctx.redirect(buildErrorRedirect(requestUrl, state.callbackUrl, 'signup_failed'))
          }
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
