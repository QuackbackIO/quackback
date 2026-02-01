/**
 * Session Transfer Plugin for Better-Auth
 *
 * Completes tenant provisioning by authenticating the workspace owner.
 * After the website provisions a workspace (schema + seed data), it creates
 * a signed JWT and redirects to this endpoint. The plugin verifies the JWT,
 * creates the user/member records, and establishes a session.
 *
 * Flow:
 * 1. Website provisions workspace (schema + seed data) and creates signed JWT
 * 2. Website redirects to: /api/auth/session-transfer?token={JWT}
 * 3. This plugin verifies the JWT signature
 * 4. Creates user and member (admin role)
 * 5. Creates session and sets cookie
 * 6. Redirects to /admin
 *
 * Cloud edition only - not included in self-hosted builds.
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { jwtVerify } from 'jose'
import { z } from 'zod'
import { generateId } from '@quackback/ids'
import type { UserId } from '@quackback/ids'

// JWT payload schema
const JwtPayloadSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  image: z.string().nullable().optional(),
  context: z.enum(['team', 'portal']),
  callbackUrl: z.string().optional(),
})

type JwtPayload = z.infer<typeof JwtPayloadSchema>

export const sessionTransfer = () => {
  return {
    id: 'session-transfer',
    endpoints: {
      sessionTransfer: createAuthEndpoint(
        '/session-transfer',
        {
          method: 'GET',
          query: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          const { token } = ctx.query
          const bootstrapSecret = process.env.CLOUD_SESSION_TRANSFER_SECRET

          // Check if session transfer is enabled (requires shared secret)
          if (!bootstrapSecret) {
            console.warn(
              'Session transfer attempted but CLOUD_SESSION_TRANSFER_SECRET not configured'
            )
            return ctx.redirect('/admin/login?error=bootstrap_not_configured')
          }

          const secret = new TextEncoder().encode(bootstrapSecret)
          let payload: JwtPayload

          // 1. Verify JWT signature and decode payload
          try {
            const { payload: rawPayload } = await jwtVerify(token, secret)
            payload = JwtPayloadSchema.parse(rawPayload)
          } catch (err) {
            console.error('Tenant bootstrap JWT verification failed:', err)
            if (err instanceof Error && err.message.includes('expired')) {
              return ctx.redirect('/admin/login?error=token_expired')
            }
            return ctx.redirect('/admin/login?error=invalid_token')
          }

          const { db, user, member, eq } = await import('@/lib/db')

          // 2. Find or create user
          const existingUser = await db.query.user.findFirst({
            where: eq(user.email, payload.email),
          })

          let userId: UserId

          if (existingUser) {
            userId = existingUser.id
            console.log(`[session-transfer] Found existing user: ${userId}`)
          } else {
            userId = generateId('user')
            await db.insert(user).values({
              id: userId,
              email: payload.email,
              name: payload.name,
              image: payload.image || null,
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            console.log(`[session-transfer] Created new user: ${userId}`)
          }

          // 3. Ensure member exists with correct role
          const existingMember = await db.query.member.findFirst({
            where: eq(member.userId, userId),
          })

          if (!existingMember) {
            await db.insert(member).values({
              id: generateId('member'),
              userId,
              role: payload.context === 'team' ? 'admin' : 'user',
              createdAt: new Date(),
            })
            console.log(
              `[session-transfer] Created member record: role=${payload.context === 'team' ? 'admin' : 'user'}`
            )
          }

          // 4. Create session using better-auth's internal adapter
          const newSession = await ctx.context.internalAdapter.createSession(userId, false)
          if (!newSession) {
            console.error('[session-transfer] Failed to create session')
            return ctx.redirect('/admin/login?error=session_failed')
          }

          // 5. Set session cookie using better-auth's cookie helper
          const authCookie = ctx.context.createAuthCookie('session_token')
          await ctx.setSignedCookie(
            authCookie.name,
            newSession.token,
            ctx.context.secret,
            authCookie.attributes
          )
          console.log(`[session-transfer] Session created and cookie set`)

          // 6. Redirect to onboarding to complete setup (creates statuses, boards)
          // Onboarding will redirect to /admin when setup is complete
          const callbackUrl = payload.callbackUrl || '/onboarding'
          console.log(`[session-transfer] Redirecting to ${callbackUrl}`)
          return ctx.redirect(callbackUrl)
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
