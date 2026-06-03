import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { db, segments, principal, eq, and, isNull, inArray } from '@/lib/server/db'
import { addMember, removeMember } from '@/lib/server/domains/segments/segment-membership.service'
import type { PrincipalId } from '@quackback/ids'

const MutateBody = z.object({
  principalIds: z.array(z.string()).min(1).max(1000),
})

/**
 * Resolve which of the supplied principalIds actually exist (and are not
 * soft-deleted) so the batch loop can't waste cycles or land partial
 * state on unknown ids. Returns the validated subset PLUS the list of
 * ids that did not resolve, so the caller can report partial failure
 * to the client honestly.
 */
async function validatePrincipals(
  requested: string[]
): Promise<{ valid: PrincipalId[]; missing: string[] }> {
  if (requested.length === 0) return { valid: [], missing: [] }
  // Dedupe so a duplicate id in the body doesn't double-add or
  // double-remove (REST callers occasionally include dupes when paging).
  const unique = Array.from(new Set(requested))
  // Only human `type='user'` principals are eligible for segment
  // membership: anonymous visitors have no stable identity for SSO
  // reconcile, and service principals (API keys, integrations) would
  // pollute board-access checks if they slipped into userSegments.
  // Filter here so the validator can't be tricked into adding either.
  const rows = await db
    .select({ id: principal.id })
    .from(principal)
    .where(and(inArray(principal.id, unique as PrincipalId[]), eq(principal.type, 'user')))
  const found = new Set(rows.map((r) => String(r.id)))
  const valid: PrincipalId[] = []
  const missing: string[] = []
  for (const id of unique) {
    if (found.has(id)) valid.push(id as PrincipalId)
    else missing.push(id)
  }
  return { valid, missing }
}

export const Route = createFileRoute('/api/v1/segments/$slug/members')({
  server: {
    handlers: {
      /**
       * POST /api/v1/segments/:slug/members
       * Add the given principalIds to the segment identified by :slug.
       *
       * Resolves the segment by `slug` (unique on non-deleted rows). Adding
       * with source='api' — the source-priority guard inside addMember
       * means we never demote a manual admin assignment.
       *
       * Returns actual-result counts (`added`, `failed`) instead of the
       * raw request count. Unknown / soft-deleted principalIds are
       * surfaced in `failed` so the caller knows the loop wasn't all
       * applied silently.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const body = MutateBody.parse(await request.json())

          const segment = await db.query.segments.findFirst({
            where: and(eq(segments.slug, params.slug), isNull(segments.deletedAt)),
            columns: { id: true },
          })
          if (!segment) return notFoundResponse('Segment')

          const { valid, missing } = await validatePrincipals(body.principalIds)

          // Per-principal mutations run in parallel — addMember is
          // idempotent under the source-priority guard so concurrency
          // is safe. allSettled keeps a single transient failure from
          // dropping every later id silently.
          const settled = await Promise.allSettled(
            valid.map((principalId) =>
              addMember({
                principalId,
                segmentId: segment.id,
                source: 'api',
                actor: {
                  userId: null,
                  email: null,
                  role: auth.role,
                },
                headers: request.headers,
              })
            )
          )

          const failed = [...missing]
          settled.forEach((r, i) => {
            if (r.status === 'rejected') failed.push(String(valid[i]))
          })
          const added = settled.filter((r) => r.status === 'fulfilled').length

          return successResponse({ added, failed })
        } catch (error) {
          if (error instanceof z.ZodError) return badRequestResponse(error.message)
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/segments/:slug/members
       * Remove the given principalIds from the segment.
       *
       * Returns actual `removed` count + `failed` list of ids that
       * didn't resolve (unknown principal, or the DELETE threw).
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const body = MutateBody.parse(await request.json())

          const segment = await db.query.segments.findFirst({
            where: and(eq(segments.slug, params.slug), isNull(segments.deletedAt)),
            columns: { id: true },
          })
          if (!segment) return notFoundResponse('Segment')

          const { valid, missing } = await validatePrincipals(body.principalIds)

          const settled = await Promise.allSettled(
            valid.map((principalId) =>
              removeMember({
                principalId,
                segmentId: segment.id,
                actor: {
                  userId: null,
                  email: null,
                  role: auth.role,
                },
                headers: request.headers,
              })
            )
          )

          const failed = [...missing]
          settled.forEach((r, i) => {
            if (r.status === 'rejected') failed.push(String(valid[i]))
          })
          const removed = settled.filter((r) => r.status === 'fulfilled').length

          return successResponse({ removed, failed })
        } catch (error) {
          if (error instanceof z.ZodError) return badRequestResponse(error.message)
          return handleDomainError(error)
        }
      },
    },
  },
})
