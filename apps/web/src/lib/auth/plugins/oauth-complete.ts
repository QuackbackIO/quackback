/**
 * OAuth Complete Plugin for Better-Auth
 *
 * Completes OAuth authentication on the tenant domain after callback from app domain.
 * Verifies JWT, creates/finds user, links OAuth account, creates session.
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { jwtVerify } from 'jose'
import { z } from 'zod'
import type { UserId } from '@quackback/ids'

const JwtPayloadSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  image: z.string().nullable(),
  provider: z.enum(['github', 'google', 'oidc', 'team-sso']),
  providerId: z.string(),
  workspace: z.string(),
  callbackUrl: z.string(),
  popup: z.boolean(),
  jti: z.string(), // JWT ID for replay attack protection
})

type JwtPayload = z.infer<typeof JwtPayloadSchema>

function redirectWithError(ctx: { redirect: (url: string) => unknown }, error: string): unknown {
  return ctx.redirect(`/auth/login?error=${error}`)
}

export function oauthComplete(): BetterAuthPlugin {
  return {
    id: 'oauth-complete',
    endpoints: {
      oauthComplete: createAuthEndpoint(
        '/oauth-complete',
        { method: 'GET', query: z.object({ token: z.string().optional() }) },
        async (ctx) => {
          const { token } = ctx.query

          if (!token) {
            return redirectWithError(ctx, 'missing_token')
          }

          const secret = process.env.CLOUD_TRANSFER_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET
          if (!secret) {
            console.error('[oauth-complete] No transfer token secret configured')
            return redirectWithError(ctx, 'config_error')
          }

          let payload: JwtPayload
          try {
            const { payload: rawPayload } = await jwtVerify(token, new TextEncoder().encode(secret))
            payload = JwtPayloadSchema.parse(rawPayload)
          } catch (err) {
            console.error('[oauth-complete] JWT verification failed:', err)
            const isExpired = err instanceof Error && err.message.includes('expired')
            return redirectWithError(ctx, isExpired ? 'token_expired' : 'invalid_token')
          }

          const { db, user, account, member, eq, and } = await import('@/lib/db')
          const { generateId } = await import('@quackback/ids')
          const isTeamSSO = payload.provider === 'team-sso'

          try {
            const existingUser = await db.query.user.findFirst({
              where: eq(user.email, payload.email),
            })

            let userId: UserId
            let isNewUser = false

            if (existingUser) {
              userId = existingUser.id
              console.log(`[oauth-complete] Found existing user: ${userId}`)

              if (isTeamSSO) {
                const existingMember = await db.query.member.findFirst({
                  where: eq(member.userId, userId),
                })
                if (!existingMember || existingMember.role === 'user') {
                  console.error(`[oauth-complete] Team SSO rejected: not a team member`)
                  return redirectWithError(ctx, 'not_team_member')
                }
              }
            } else {
              if (isTeamSSO) {
                console.error(`[oauth-complete] Team SSO rejected: user does not exist`)
                return redirectWithError(ctx, 'not_team_member')
              }

              userId = generateId('user')
              isNewUser = true

              await db.insert(user).values({
                id: userId,
                email: payload.email,
                name: payload.name,
                image: payload.image,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              console.log(`[oauth-complete] Created new user: ${userId}`)
            }

            const existingAccount = await db.query.account.findFirst({
              where: and(
                eq(account.userId, userId),
                eq(account.providerId, payload.provider),
                eq(account.accountId, payload.providerId)
              ),
            })

            if (!existingAccount) {
              await db.insert(account).values({
                id: generateId('account'),
                userId,
                providerId: payload.provider,
                accountId: payload.providerId,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              console.log(`[oauth-complete] Linked ${payload.provider} account`)
            }

            if (isNewUser) {
              const existingMember = await db.query.member.findFirst({
                where: eq(member.userId, userId),
              })

              if (!existingMember) {
                await db.insert(member).values({
                  id: generateId('member'),
                  userId,
                  role: 'user',
                  createdAt: new Date(),
                })
                console.log(`[oauth-complete] Created member record`)
              }
            }

            const newSession = await ctx.context.internalAdapter.createSession(userId, false)
            if (!newSession) {
              console.error(`[oauth-complete] Failed to create session`)
              return redirectWithError(ctx, 'session_failed')
            }

            const authCookie = ctx.context.createAuthCookie('session_token')
            await ctx.setSignedCookie(
              authCookie.name,
              newSession.token,
              ctx.context.secret,
              authCookie.attributes
            )

            console.log(`[oauth-complete] Auth complete, redirecting to ${payload.callbackUrl}`)
            return ctx.redirect(payload.callbackUrl)
          } catch (err) {
            console.error('[oauth-complete] Error:', err)
            return redirectWithError(ctx, 'auth_failed')
          }
        }
      ),
    },
  }
}
