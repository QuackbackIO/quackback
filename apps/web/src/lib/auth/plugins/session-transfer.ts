/**
 * Session Transfer Plugin for Better-Auth
 *
 * Enables cross-domain session transfer from quackback.io to workspace apps.
 * After workspace provisioning, the website creates a signed JWT containing
 * user info and redirects to the new workspace. This plugin verifies the
 * JWT and creates a local session, completing the handoff.
 *
 * Flow:
 * 1. Website provisions workspace and creates signed JWT
 * 2. Website redirects to: /api/auth/session-transfer?token={JWT}
 * 3. This plugin verifies the JWT signature
 * 4. Creates/finds user and creates session
 * 5. Redirects to /admin with session cookie
 *
 * Cloud edition only - not included in self-hosted builds.
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { jwtVerify } from 'jose'
import { z } from 'zod'
import crypto from 'crypto'
import { generateId } from '@quackback/ids'

type CfEnv = { TRANSFER_TOKEN_SECRET?: string; NODE_ENV?: string }

// Cloudflare Workers env - lazily initialized at runtime
let cfEnv: CfEnv | undefined
let cfEnvInitialized = false

async function getCfEnv(): Promise<CfEnv | undefined> {
  if (cfEnvInitialized) return cfEnv
  cfEnvInitialized = true

  try {
    // Dynamic import to avoid build-time errors in non-CF environments
    // @ts-expect-error - cloudflare:workers is only available in CF Workers runtime
    const cf = await import(/* @vite-ignore */ 'cloudflare:workers')
    cfEnv = cf.env as CfEnv
  } catch {
    // Not running in Cloudflare Workers - use process.env only
  }
  return cfEnv
}

async function getEnv() {
  const env = await getCfEnv()
  return {
    TRANSFER_TOKEN_SECRET: env?.TRANSFER_TOKEN_SECRET || process.env.TRANSFER_TOKEN_SECRET,
    NODE_ENV: env?.NODE_ENV || process.env.NODE_ENV,
  }
}

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
          const { TRANSFER_TOKEN_SECRET: transferSecret, NODE_ENV } = await getEnv()

          // Check if session-transfer is enabled (requires shared secret)
          if (!transferSecret) {
            console.warn('Session transfer attempted but TRANSFER_TOKEN_SECRET not configured')
            return ctx.redirect('/admin/login?error=session_transfer_not_configured')
          }

          const secret = new TextEncoder().encode(transferSecret)
          let payload: JwtPayload

          // 1. Verify JWT signature and decode payload
          try {
            const { payload: rawPayload } = await jwtVerify(token, secret)
            payload = JwtPayloadSchema.parse(rawPayload)
          } catch (err) {
            console.error('Session transfer JWT verification failed:', err)
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
            secure: NODE_ENV === 'production',
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
