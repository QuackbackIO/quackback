import { createFileRoute } from '@tanstack/react-router'
import { createHmac, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { generateId } from '@featurepool/ids'
import type { UserId, PrincipalId } from '@featurepool/ids'
import { db, user, session, principal, eq, and, gt } from '@/lib/server/db'
import { getWidgetConfig, getWidgetSecret } from '@/lib/server/domains/settings/settings.widget'
import { getAllUserVotedPostIds } from '@/lib/server/domains/posts/post.public'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { resolveAndMergeAnonymousToken } from '@/lib/server/auth/identify-merge'

// Accept either legacy HMAC fields or a JWT ssoToken
const identifySchema = z
  .object({
    // JWT mode (preferred)
    ssoToken: z.string().optional(),
    // Legacy HMAC mode
    id: z.string().optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    avatarURL: z.string().url().optional(),
    created: z.string().optional(),
    hash: z.string().optional(),
    // Anonymous→identified merge: previous widget session token
    previousToken: z.string().optional(),
  })
  .refine((data) => data.ssoToken || (data.id && data.email), {
    message: 'Either ssoToken or (id + email) is required',
  })

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status })
}

async function findOrCreateSession(userId: UserId, request: Request): Promise<string> {
  const existingSession = await db.query.session.findFirst({
    where: and(eq(session.userId, userId), gt(session.expiresAt, new Date())),
  })
  if (existingSession) {
    await db
      .update(session)
      .set({ updatedAt: new Date() })
      .where(eq(session.id, existingSession.id))
    return existingSession.token
  }
  const token = crypto.randomUUID()
  const now = new Date()
  await db.insert(session).values({
    id: crypto.randomUUID(),
    token,
    userId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
    updatedAt: now,
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  })
  return token
}

/**
 * Verify a HS256 JWT without external libraries.
 * Returns the decoded payload or null if invalid.
 */
export function verifyHS256JWT(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [headerB64, payloadB64, signatureB64] = parts

  // Verify header is HS256
  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
    if (header.alg !== 'HS256') return null
  } catch {
    return null
  }

  // Verify signature
  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')

  const sigBuf = Buffer.from(signatureB64, 'base64url')
  const expBuf = Buffer.from(expected, 'base64url')
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null
  }

  // Decode payload
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())

    // Check expiry if present
    if (payload.exp && typeof payload.exp === 'number') {
      if (Math.floor(Date.now() / 1000) > payload.exp) return null
    }

    return payload
  } catch {
    return null
  }
}

interface IdentifiedUser {
  id: string
  email: string
  name?: string
  avatarURL?: string
}

export const Route = createFileRoute('/api/widget/identify')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const widgetConfig = await getWidgetConfig()
        if (!widgetConfig.enabled) {
          return jsonError('WIDGET_DISABLED', 'Widget is not enabled', 403)
        }

        let body: z.infer<typeof identifySchema>
        try {
          const raw = await request.json()
          body = identifySchema.parse(raw)
        } catch {
          return jsonError(
            'VALIDATION_ERROR',
            'Invalid request body: provide ssoToken or (id + email)',
            400
          )
        }

        let identified: IdentifiedUser

        if (body.ssoToken) {
          // JWT mode: verify the ssoToken
          const secret = await getWidgetSecret()
          if (!secret) {
            return jsonError('SERVER_ERROR', 'Widget secret not configured', 500)
          }

          const payload = verifyHS256JWT(body.ssoToken, secret)
          if (!payload) {
            return jsonError('TOKEN_INVALID', 'Invalid or expired ssoToken', 403)
          }

          // Extract user data from JWT claims
          const sub = payload.sub || payload.id
          const email = payload.email
          if (typeof sub !== 'string' || typeof email !== 'string') {
            return jsonError(
              'TOKEN_INVALID',
              'ssoToken must contain sub (or id) and email claims',
              400
            )
          }

          identified = {
            id: sub,
            email,
            name: typeof payload.name === 'string' ? payload.name : undefined,
            avatarURL: typeof payload.avatarURL === 'string' ? payload.avatarURL : undefined,
          }
        } else if (body.id && body.email) {
          // Legacy HMAC mode
          if (widgetConfig.identifyVerification) {
            if (!body.hash) {
              return jsonError(
                'VALIDATION_ERROR',
                'HMAC hash is required when verification is enabled',
                400
              )
            }

            const secret = await getWidgetSecret()
            if (!secret) {
              return jsonError('SERVER_ERROR', 'Widget secret not configured', 500)
            }

            const expectedHash = createHmac('sha256', secret).update(body.id).digest('hex')
            const hashBuffer = Buffer.from(body.hash, 'hex')
            const expectedBuffer = Buffer.from(expectedHash, 'hex')

            if (
              hashBuffer.length !== expectedBuffer.length ||
              !timingSafeEqual(hashBuffer, expectedBuffer)
            ) {
              return jsonError('HMAC_INVALID', 'Hash verification failed', 403)
            }
          }

          identified = {
            id: body.id,
            email: body.email,
            name: body.name,
            avatarURL: body.avatarURL,
          }
        } else {
          return jsonError('VALIDATION_ERROR', 'Provide ssoToken or (id + email)', 400)
        }

        // Find or create user
        let userRecord = await db.query.user.findFirst({
          where: eq(user.email, identified.email),
        })

        if (userRecord) {
          const updates: Record<string, string> = {}
          if (identified.name && identified.name !== userRecord.name) updates.name = identified.name
          if (identified.avatarURL && identified.avatarURL !== userRecord.image)
            updates.image = identified.avatarURL

          if (Object.keys(updates).length > 0) {
            await db.update(user).set(updates).where(eq(user.id, userRecord.id))
          }
        } else {
          const [created] = await db
            .insert(user)
            .values({
              id: generateId('user'),
              name: identified.name || identified.email.split('@')[0],
              email: identified.email,
              emailVerified: false,
              image: identified.avatarURL ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning()
          userRecord = created
        }

        const userId = userRecord.id as UserId

        // Ensure principal record exists
        let principalRecord = await db.query.principal.findFirst({
          where: eq(principal.userId, userId),
        })

        if (!principalRecord) {
          const [created] = await db
            .insert(principal)
            .values({
              id: generateId('principal'),
              userId,
              role: 'user',
              displayName: userRecord.name,
              avatarUrl: userRecord.image ?? null,
              createdAt: new Date(),
            })
            .returning()
          principalRecord = created
        }

        const principalId = principalRecord.id as PrincipalId

        // If the widget had a previous anonymous session, merge its activity.
        // Ownership check: the caller must send the previousToken as both a body
        // field AND the Authorization Bearer header to prove they own the session.
        if (body.previousToken) {
          const authHeader = request.headers.get('authorization') ?? ''
          const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
          if (bearerToken && bearerToken === body.previousToken) {
            await resolveAndMergeAnonymousToken({
              previousToken: body.previousToken,
              targetPrincipalId: principalId,
              targetDisplayName: userRecord.name || 'User',
            })
          }
        }

        // Find/create session and fetch voted posts in parallel
        // (voted posts include any merged anonymous votes)
        const [sessionToken, votedPostIdSet] = await Promise.all([
          findOrCreateSession(userId, request),
          getAllUserVotedPostIds(principalId),
        ])
        const votedPostIds = Array.from(votedPostIdSet)

        // No Set-Cookie — the widget sends the token as Bearer header.
        // An unsigned cookie here would poison Better Auth's signed-cookie
        // lookup in same-site deployments (#99).
        // Resolve avatar: custom upload (S3) takes priority over OAuth URL
        const avatarUrl =
          (userRecord.imageKey ? getPublicUrlOrNull(userRecord.imageKey) : null) ??
          userRecord.image ??
          null

        return Response.json({
          sessionToken,
          user: {
            id: userRecord.id,
            name: userRecord.name,
            email: userRecord.email,
            avatarUrl,
          },
          votedPostIds,
        })
      },
    },
  },
})
