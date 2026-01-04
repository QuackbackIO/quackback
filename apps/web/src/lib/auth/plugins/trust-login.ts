/**
 * Trust Login Plugin for Better-Auth
 *
 * Enables cross-domain session transfer from the website to workspace apps.
 * The website creates a signed JWT containing user info, and this plugin
 * verifies it and creates a local session.
 *
 * Flow:
 * 1. Website provisions workspace and creates signed JWT
 * 2. Website redirects to: /api/auth/trust-login?token={JWT}
 * 3. This plugin verifies the JWT signature
 * 4. Creates/finds user and creates session
 * 5. Redirects to /admin with session cookie
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { jwtVerify } from 'jose'
import { z } from 'zod'
import crypto from 'crypto'
import { generateId } from '@quackback/ids'

// JWT payload schema
const JwtPayloadSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  image: z.string().nullable().optional(),
  context: z.enum(['team', 'portal']),
  callbackUrl: z.string().optional(),
})

type JwtPayload = z.infer<typeof JwtPayloadSchema>

export const trustLogin = () => {
  return {
    id: 'trust-login',
    endpoints: {
      trustLogin: createAuthEndpoint(
        '/trust-login',
        {
          method: 'GET',
          query: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          const { token } = ctx.query
          const transferSecret = process.env.TRANSFER_TOKEN_SECRET

          // Check if trust-login is enabled (requires shared secret)
          if (!transferSecret) {
            console.warn('Trust-login attempted but TRANSFER_TOKEN_SECRET not configured')
            return ctx.redirect('/admin/login?error=trust_login_not_configured')
          }

          const secret = new TextEncoder().encode(transferSecret)
          let payload: JwtPayload

          // 1. Verify JWT signature and decode payload
          try {
            const { payload: rawPayload } = await jwtVerify(token, secret)
            payload = JwtPayloadSchema.parse(rawPayload)
          } catch (err) {
            console.error('Trust-login JWT verification failed:', err)
            if (err instanceof Error && err.message.includes('expired')) {
              return ctx.redirect('/admin/login?error=token_expired')
            }
            return ctx.redirect('/admin/login?error=invalid_token')
          }

          const { db, user, member, session, eq } = await import('@/lib/db')

          // 2. Find or create user
          let existingUser = await db.query.user.findFirst({
            where: eq(user.email, payload.email),
          })

          if (!existingUser) {
            const [newUser] = await db
              .insert(user)
              .values({
                id: generateId('user'),
                email: payload.email,
                name: payload.name,
                image: payload.image || null,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning()
            existingUser = newUser

            // Create member record for new user
            await db.insert(member).values({
              id: generateId('member'),
              userId: existingUser.id,
              role: payload.context === 'team' ? 'owner' : 'user',
              createdAt: new Date(),
            })
          }

          // 3. Create session
          const sessionId = crypto.randomUUID()
          const sessionToken = crypto.randomUUID()
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

          await db.insert(session).values({
            id: sessionId,
            userId: existingUser.id,
            token: sessionToken,
            expiresAt,
            createdAt: new Date(),
            updatedAt: new Date(),
            ipAddress: ctx.headers?.get('x-forwarded-for') || null,
            userAgent: ctx.headers?.get('user-agent') || null,
          })

          // 4. Set session cookie
          ctx.setCookie('better-auth.session_token', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
            path: '/',
          })

          // 5. Redirect to callback URL or default
          const callbackUrl = payload.callbackUrl || '/admin'
          return ctx.redirect(callbackUrl)
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
