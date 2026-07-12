import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { generateId } from '@quackback/ids'
import type { UserId, PrincipalId, SegmentId } from '@quackback/ids'
import {
  db,
  user,
  session,
  segments,
  principal,
  widgetIdentifiedSession,
  eq,
  and,
  gt,
  isNull,
  sql,
} from '@/lib/server/db'
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import { isBlocked } from '@/lib/server/domains/principals/blocking'
import { isTeamMember } from '@/lib/shared/roles'
import { getWidgetConfig, getWidgetSecret } from '@/lib/server/domains/settings/settings.widget'
import { getAllUserVotedPostIds } from '@/lib/server/domains/posts/post.public'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { resolveAndMergeAnonymousToken } from '@/lib/server/auth/identify-merge'
import { verifyHS256JWT } from '@/lib/server/widget/identity-token'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { checkWidgetIdentifyRateLimit } from '@/lib/server/auth/widget-rate-limit'
import { validateAndCoerceAttributes } from '@/lib/server/domains/users/user.attributes'
import { reconcileWidgetMemberships } from '@/lib/server/domains/segments/segment-membership.service'
import { captureCountryFromHeaders } from '@/lib/server/auth/country-capture'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-identify' })

// Identify is verified-only: a session for a real user is minted exclusively
// from an ssoToken signed by the customer's own backend with the widget
// secret. There is no unverified id+email path — accepting one would let any
// visitor claim an arbitrary email (see GH issue #300); anonymous visitors get
// anonymous sessions elsewhere and never identify.
const identifySchema = z.object({
  ssoToken: z.string().min(1),
  // Anonymous→identified merge: previous widget session token
  previousToken: z.string().optional(),
})

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
    where: and(
      eq(session.userId, userId),
      gt(session.expiresAt, new Date()),
      sql`exists (select 1 from widget_identified_session wis where wis.session_id = ${session.id} and wis.hmac_verified = true)`
    ),
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
    ipAddress: getClientIp(request),
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

        // Bound identify attempts per client before any token work (Phase 6 R1):
        // this endpoint is open, so it must not be an unmetered ssoToken oracle.
        const rl = await checkWidgetIdentifyRateLimit(getClientIp(request.headers)).catch(() => ({
          allowed: true,
        }))
        if (!rl.allowed) {
          return jsonError(
            'RATE_LIMITED',
            'Too many identify attempts, please try again later',
            429
          )
        }

        let body: z.infer<typeof identifySchema>
        try {
          const raw = await request.json()
          body = identifySchema.parse(raw)
        } catch {
          return jsonError('VALIDATION_ERROR', 'Invalid request body', 400)
        }

        // Verified-only: the HMAC-signed JWT from the customer's backend is the
        // sole identity source (see identifySchema note / GH issue #300).
        const widgetSecret = await getWidgetSecret()
        if (!widgetSecret) {
          return jsonError('SERVER_ERROR', 'Widget secret not configured', 500)
        }
        const payload = verifyHS256JWT(body.ssoToken, widgetSecret)
        if (!payload) {
          return jsonError('TOKEN_INVALID', 'Invalid or expired ssoToken', 403)
        }
        const claims: Record<string, unknown> = payload

        // Extract identity fields from the JWT claims
        const sub =
          typeof claims.sub === 'string'
            ? claims.sub
            : typeof claims.id === 'string'
              ? claims.id
              : undefined
        const email = typeof claims.email === 'string' ? claims.email : undefined
        if (!sub || !email) {
          return jsonError(
            'TOKEN_INVALID',
            'ssoToken must contain sub (or id) and email claims',
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

        // Find or create user. Case-insensitive on email — the staff/admin
        // identity guard below would otherwise be bypassable by varying the
        // casing of a teammate's email ("ADMIN@x.com" wouldn't match the
        // stored "admin@x.com" and a fresh user row would be created
        // with role 'user' AND the same email address, breaking the
        // "one email per account" invariant. The fix mirrors the
        // segment-evaluator + recovery-codes case-insensitive lookups.
        const normalizedEmail = identified.email.toLowerCase()
        // The JWT `sub` is the durable cross-device identity key — resolve by
        // it first so a returning visitor is recognized even after an email
        // change in the host app. Trusting it is safe: only the customer's
        // backend holds the widget secret that signed it.
        const externalId = identified.id
        let userRecord = await db.query.user.findFirst({
          where: eq(user.externalId, externalId),
        })
        if (!userRecord) {
          userRecord = await db.query.user.findFirst({
            where: sql`LOWER(${user.email}) = ${normalizedEmail}`,
          })
        }

        const country = captureCountryFromHeaders(request.headers)

        if (userRecord) {
          // Staff/admin identity guard: a signed ssoToken only vouches for
          // email/sub matching, never for role. If those claims resolve to an
          // existing teammate account (principal role 'admin' or 'member'),
          // refuse before touching that row any further — a widget embedded
          // on a customer's site must never be able to mint or piggyback a
          // session that can authorize dashboard/admin APIs.
          const existingPrincipal = await db.query.principal.findFirst({
            where: eq(principal.userId, userRecord.id),
            columns: { role: true },
          })
          if (existingPrincipal && isTeamMember(existingPrincipal.role)) {
            return jsonError(
              'IDENTITY_NOT_ALLOWED',
              'This identity cannot be used with the widget',
              403
            )
          }

          const updates: Record<string, unknown> = {}
          if (identified.name && identified.name !== userRecord.name) updates.name = identified.name
          if (identified.avatarURL && identified.avatarURL !== userRecord.image)
            updates.image = identified.avatarURL
          if (hasAttrs) {
            // Atomic JSONB merge in SQL (not a JS read/merge/write) so a
            // concurrent writer landing between the load above and this
            // update can never be clobbered. Mirrors user.identify.ts. The
            // `metadata` column is text-typed, so round-trip through jsonb
            // and back to text; there are no removals on this path.
            updates.metadata = sql`((coalesce(nullif(${user.metadata}, ''), '{}')::jsonb - ${[]}::text[]) || ${JSON.stringify(validAttrs)}::jsonb)::text`
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
        // or more segment slugs in the signed JWT. Unknown slugs are silently
        // skipped. Lookup by slug (unique), not name.
        //
        // The reconcile is what makes the claim authoritative on every
        // identify: adding NEW slugs grants membership, dropping a slug
        // from the JWT REMOVES the corresponding widget-sourced
        // membership. Without this, a canceled customer would keep their
        // `enterprise` membership forever and retain portal-access via
        // allowedSegmentIds. Manual / sso / api memberships are sticky
        // (addedBy='widget' filter inside reconcileWidgetMemberships).
        const rawSegments = Array.isArray(claims.segments) ? claims.segments : []
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

        // Changelog auto-subscribe touchpoint (Changelog Settings §2): a
        // verified widget identify is one of the cheapest "we now know this
        // person" moments — already resolving/creating the principal on this
        // request. No-op when changelog.autoSubscribe is off or the row
        // already exists.
        const { ensureAutoSubscribed } =
          await import('@/lib/server/domains/changelog/changelog-subscription.service')
        ensureAutoSubscribed(principalId).catch((err) =>
          log.error({ err }, 'failed to auto-subscribe to changelog on widget identify')
        )

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

        // Re-registration prevention (support platform §4.6): a blocked person
        // cannot mint a session by identifying. Checked AFTER the previousToken
        // merge so a block inherited from a blocked anonymous session (via the
        // fill-if-empty repoint step) is caught too.
        if (await isBlocked(principalId)) {
          return jsonError('BLOCKED', 'This account is blocked.', 403)
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
        // the portal widget branch. Identify is verified-only, so every
        // identified session carries hmacVerified=true.
        await recordWidgetSessionProvenance(sessionInfo.id, true)

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
