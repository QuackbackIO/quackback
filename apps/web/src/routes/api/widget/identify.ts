import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { generateId } from '@quackback/ids'
import type { UserId, PrincipalId, SegmentId } from '@quackback/ids'
import {
  db,
  user,
  session,
  principal,
  segments,
  widgetIdentifiedSession,
  eq,
  and,
  gt,
  isNull,
  sql,
} from '@/lib/server/db'
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import { getWidgetConfig, getWidgetSecret } from '@/lib/server/domains/settings/settings.widget'
import { getAllUserVotedPostIds } from '@/lib/server/domains/posts/post.public'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { resolveAndMergeAnonymousToken } from '@/lib/server/auth/identify-merge'
import { verifyHS256JWT } from '@/lib/server/widget/identity-token'
import {
  validateAndCoerceAttributes,
  mergeMetadata,
} from '@/lib/server/domains/users/user.attributes'
import { reconcileWidgetMemberships } from '@/lib/server/domains/segments/segment-membership.service'
import { captureCountryFromHeaders } from '@/lib/server/auth/country-capture'

const identifySchema = z
  .object({
    // Verified path
    ssoToken: z.string().min(1).optional(),
    // Unverified path
    id: z.string().min(1).optional(),
    sub: z.string().min(1).optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    avatarURL: z.string().optional(),
    avatarUrl: z.string().optional(),
    // Anonymous→identified merge: previous widget session token
    previousToken: z.string().optional(),
  })
  .passthrough()

/** JWT claims that are identity fields or standard JWT metadata — not custom attributes */
export const RESERVED_JWT_CLAIMS = new Set([
  'sub',
  'id',
  'email',
  'name',
  'avatarURL',
  'avatarUrl',
  'segments',
  'iat',
  'exp',
  'nbf',
  'iss',
  'aud',
  'jti',
])

/** Extract non-reserved claims from a verified JWT payload for attribute processing */
export function extractCustomClaims(payload: Record<string, unknown>): Record<string, unknown> {
  const custom: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (!RESERVED_JWT_CLAIMS.has(key)) {
      custom[key] = value
    }
  }
  return custom
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status })
}

/**
 * Record the HMAC-verification provenance of a widget-identified
 * session. Upsert semantics — re-identifying the same session flips
 * `hmacVerified` to the latest value, so a session that loses HMAC
 * verification on a re-identify must lose the trust it carries.
 *
 * The widget handoff route reads this row before inserting a
 * `widget_origin_session` marker; without an `hmacVerified=true`
 * row, the handoff refuses to grant the portal widget branch.
 *
 * Exported for unit-test reach. Called once per identify, after
 * `findOrCreateSession` returns the session token.
 */
export async function recordWidgetSessionProvenance(
  sessionId: string,
  hmacVerified: boolean
): Promise<void> {
  await db
    .insert(widgetIdentifiedSession)
    .values({ sessionId, hmacVerified })
    .onConflictDoUpdate({
      target: widgetIdentifiedSession.sessionId,
      set: { hmacVerified, identifiedAt: sql`now()` },
    })
}

async function findOrCreateSession(
  userId: UserId,
  request: Request
): Promise<{ id: string; token: string }> {
  const existingSession = await db.query.session.findFirst({
    where: and(eq(session.userId, userId), gt(session.expiresAt, new Date())),
  })
  if (existingSession) {
    await db
      .update(session)
      .set({ updatedAt: new Date() })
      .where(eq(session.id, existingSession.id))
    return { id: existingSession.id, token: existingSession.token }
  }
  const token = crypto.randomUUID()
  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(session).values({
    id,
    token,
    userId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
    updatedAt: now,
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
  })
  return { id, token }
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
          return jsonError('VALIDATION_ERROR', 'Invalid request body', 400)
        }

        // Determine identity source: verified JWT or unverified body fields
        let claims: Record<string, unknown>
        let claimsAreVerified = false

        if (body.ssoToken) {
          const widgetSecret = await getWidgetSecret()
          if (!widgetSecret) {
            return jsonError('SERVER_ERROR', 'Widget secret not configured', 500)
          }
          const payload = verifyHS256JWT(body.ssoToken, widgetSecret)
          if (!payload) {
            return jsonError('TOKEN_INVALID', 'Invalid or expired ssoToken', 403)
          }
          claims = payload
          claimsAreVerified = true
        } else {
          // Unverified identify — only allowed when verified-identity-only is off
          if (widgetConfig.identifyVerification) {
            return jsonError(
              'TOKEN_REQUIRED',
              'ssoToken is required when verified identity is enabled',
              403
            )
          }
          // Strip session-management fields so they're not treated as attributes.
          // Also strip `segments` — an unverified body must NOT grant segment
          // membership, which is an access-control surface (anyone could self-
          // assign to 'enterprise' otherwise).
          claims = { ...body } as Record<string, unknown>
          delete claims.ssoToken
          delete claims.previousToken
          delete claims.segments
        }

        // Extract identity fields, supporting both JWT and unverified body shapes
        const sub =
          typeof claims.sub === 'string'
            ? claims.sub
            : typeof claims.id === 'string'
              ? claims.id
              : undefined
        const email = typeof claims.email === 'string' ? claims.email : undefined
        if (!sub || !email) {
          return jsonError(
            body.ssoToken ? 'TOKEN_INVALID' : 'VALIDATION_ERROR',
            body.ssoToken
              ? 'ssoToken must contain sub (or id) and email claims'
              : 'id (or sub) and email are required',
            400
          )
        }

        const identified: IdentifiedUser = {
          id: sub,
          email,
          name: typeof claims.name === 'string' ? claims.name : undefined,
          avatarURL:
            typeof claims.avatarURL === 'string'
              ? claims.avatarURL
              : typeof claims.avatarUrl === 'string'
                ? claims.avatarUrl
                : undefined,
        }

        // Extract custom attributes (silently drop unknown/invalid)
        const customClaims = extractCustomClaims(claims)
        let validAttrs: Record<string, unknown> = {}
        if (Object.keys(customClaims).length > 0) {
          const { valid } = await validateAndCoerceAttributes(customClaims)
          validAttrs = valid
        }
        const hasAttrs = Object.keys(validAttrs).length > 0

        // Find or create user. Case-insensitive on email — the team-role
        // guard below would otherwise be bypassable by varying the
        // casing of an admin's email ("ADMIN@x.com" wouldn't match the
        // stored "admin@x.com" and a fresh user row would be created
        // with role 'user' AND the same email address, breaking the
        // "one email per account" invariant. The fix mirrors the
        // segment-evaluator + recovery-codes case-insensitive lookups.
        const normalizedEmail = identified.email.toLowerCase()
        // Verified ssoToken: the JWT `sub` is the durable cross-device identity
        // key — resolve by it first so a returning visitor is recognized even
        // after an email change in the host app. NEVER trust `sub` on the
        // unverified path (the client controls it there), so external_id stays
        // null and unread for id+email bodies.
        const externalId = claimsAreVerified ? identified.id : null
        let userRecord = externalId
          ? await db.query.user.findFirst({ where: eq(user.externalId, externalId) })
          : undefined
        if (!userRecord) {
          userRecord = await db.query.user.findFirst({
            where: sql`LOWER(${user.email}) = ${normalizedEmail}`,
          })
        }

        // Team-role guard: refuse to mint a session-Bearer for an email
        // that already backs a team principal (admin or member). The Bearer
        // the route hands out is a normal Better Auth session token — `bearer()`
        // is registered globally, so it satisfies `auth.api.getSession()` at
        // every server function, including `requireAuth({ roles: ['admin'] })`.
        // Allowing this in the unverified path would turn "knowing an admin's
        // email" into full admin takeover. Customer-tier collisions (role='user')
        // remain allowed — that's the documented trust model for unverified
        // identify. The verified (ssoToken) path is exempt: HMAC vouches for it.
        if (!claimsAreVerified && userRecord) {
          const existingPrincipal = await db.query.principal.findFirst({
            where: eq(principal.userId, userRecord.id as UserId),
            columns: { role: true },
          })
          if (existingPrincipal?.role === 'admin' || existingPrincipal?.role === 'member') {
            return jsonError(
              'IDENTITY_LOCKED',
              'This address is bound to a team account. Use a verified ssoToken to identify.',
              403
            )
          }
        }

        const country = captureCountryFromHeaders(request.headers)

        if (userRecord) {
          const updates: Record<string, string> = {}
          if (identified.name && identified.name !== userRecord.name) updates.name = identified.name
          if (identified.avatarURL && identified.avatarURL !== userRecord.image)
            updates.image = identified.avatarURL
          if (hasAttrs) {
            updates.metadata = mergeMetadata(userRecord.metadata ?? null, validAttrs, [])
          }
          if (country && country !== userRecord.country) {
            updates.country = country
          }
          if (externalId && userRecord.externalId !== externalId) {
            // First verified sight of this account — stamp the durable subject.
            updates.externalId = externalId
          }
          if (externalId && userRecord.email !== normalizedEmail) {
            // `sub` is authoritative on a verified email change. Adopt the new
            // address unless another row already holds it — the partial-unique
            // email index would otherwise reject the move, and external_id still
            // resolves this visitor either way.
            const emailHolder = await db.query.user.findFirst({
              columns: { id: true },
              where: sql`LOWER(${user.email}) = ${normalizedEmail}`,
            })
            if (!emailHolder || emailHolder.id === userRecord.id) {
              updates.email = normalizedEmail
            }
          }

          if (Object.keys(updates).length > 0) {
            await db.update(user).set(updates).where(eq(user.id, userRecord.id))
          }
        } else {
          const [created] = await db
            .insert(user)
            .values({
              id: generateId('user'),
              name: identified.name || identified.email.split('@')[0],
              // Persist lowercase so future LOWER(email) lookups stay
              // index-eligible and the "one email per account" invariant
              // holds across mixed-case identify calls.
              email: normalizedEmail,
              emailVerified: false,
              image: identified.avatarURL ?? null,
              metadata: hasAttrs ? JSON.stringify(validAttrs) : null,
              country: country ?? null,
              // Only the verified path supplies a trusted subject; null otherwise.
              externalId,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning()
          userRecord = created
        }

        const userId = userRecord.id as UserId

        // Ensure principal record exists (read-first, race-safe).
        const { principal: principalRecord } = await ensurePrincipalForUser({
          userId,
          role: 'user',
          displayName: userRecord.name,
          avatarUrl: userRecord.image ?? null,
        })

        const principalId = principalRecord.id as PrincipalId

        // Segments claim — the customer can tag the identified user with one
        // or more segment slugs in the signed JWT. ONLY honored on the
        // verified-token path; the unverified body's `segments` was stripped
        // above (else any visitor could self-assign to 'enterprise'). Unknown
        // slugs are silently skipped. Lookup by slug (unique), not name.
        //
        // The reconcile is what makes the claim authoritative on every
        // identify: adding NEW slugs grants membership, dropping a slug
        // from the JWT REMOVES the corresponding widget-sourced
        // membership. Without this, a canceled customer would keep their
        // `enterprise` membership forever and retain portal-access via
        // allowedSegmentIds. Manual / sso / api memberships are sticky
        // (addedBy='widget' filter inside reconcileWidgetMemberships).
        // Reconcile widget-sourced memberships on EVERY identify, not
        // only the verified path. A previously-verified session that
        // later re-identifies on the unverified path (e.g. admin flipped
        // off identifyVerification, or the embedding code regressed)
        // would otherwise keep its stale 'enterprise' membership
        // indefinitely — exactly the bug reconcileWidgetMemberships was
        // added to close. The unverified path supplies no segment claim
        // (already stripped), so it reconciles to []: any widget-sourced
        // row gets dropped, manual / sso / api stay sticky.
        const rawSegments =
          claimsAreVerified && Array.isArray(claims.segments) ? claims.segments : []
        // Dedupe + filter non-strings BEFORE the DB lookup so we don't
        // round-trip per duplicate. Previously this was a per-slug
        // findFirst loop — a 10-slug claim was 10 sequential queries
        // on the identify hot path. Batch via inArray.
        const slugSet = new Set<string>()
        for (const slug of rawSegments) {
          if (typeof slug === 'string' && slug.length > 0) slugSet.add(slug)
        }
        let resolvedSegmentIds: SegmentId[] = []
        if (slugSet.size > 0) {
          const slugList = Array.from(slugSet)
          const { inArray } = await import('@/lib/server/db')
          const rows = await db.query.segments.findMany({
            where: and(inArray(segments.slug, slugList), isNull(segments.deletedAt)),
            columns: { id: true },
          })
          resolvedSegmentIds = rows.map((r) => r.id)
        }
        await reconcileWidgetMemberships({
          principalId,
          desiredSegmentIds: resolvedSegmentIds,
        })

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
        const [sessionInfo, votedPostIdSet] = await Promise.all([
          findOrCreateSession(userId, request),
          getAllUserVotedPostIds(principalId),
        ])
        const votedPostIds = Array.from(votedPostIdSet)

        // Record HMAC-verification provenance for this session. The
        // widget-handoff route reads this to decide whether to grant
        // the portal widget branch — without an hmacVerified=true row,
        // the handoff refuses to insert the widget_origin_session
        // marker. Upsert by sessionId; re-identifying via the
        // unverified path demotes a previously-verified row, so a
        // session that loses HMAC verification loses its trust.
        await recordWidgetSessionProvenance(sessionInfo.id, claimsAreVerified)

        // No Set-Cookie — the widget sends the token as Bearer header.
        // An unsigned cookie here would poison Better Auth's signed-cookie
        // lookup in same-site deployments (#99).
        // Resolve avatar: custom upload (S3) takes priority over OAuth URL
        const avatarUrl =
          (userRecord.imageKey ? getPublicUrlOrNull(userRecord.imageKey) : null) ??
          userRecord.image ??
          null

        return Response.json({
          sessionToken: sessionInfo.token,
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
