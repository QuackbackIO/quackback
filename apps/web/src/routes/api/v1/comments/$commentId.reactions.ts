import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { Role } from '@/lib/server/policy/types'
import type { CommentId } from '@quackback/ids'

// Input validation schema. Emoji is required for both add and remove.
const reactionSchema = z.object({
  emoji: z.string().min(1, 'Emoji is required').max(64),
})

export const Route = createFileRoute('/api/v1/comments/$commentId/reactions')({
  server: {
    handlers: {
      /**
       * POST /api/v1/comments/:commentId/reactions
       * Add an emoji reaction to a comment, attributed to the API key's principal.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })

          const commentId = parseTypeId<CommentId>(params.commentId, 'comment', 'comment ID')

          const body = await request.json()
          const parsed = reactionSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { addReaction } = await import('@/lib/server/domains/comments/comment.reactions')
          const { segmentIdsForPrincipal } =
            await import('@/lib/server/domains/segments/segment-membership.service')
          const { db, principal, eq } = await import('@/lib/server/db')

          const [callerSegmentIds, callerRecord] = await Promise.all([
            segmentIdsForPrincipal(auth.principalId),
            db.query.principal.findFirst({
              where: eq(principal.id, auth.principalId),
              columns: { type: true },
            }),
          ])

          // Build the policy actor from the API-key holder (the caller) so the
          // canViewPost + isPrivate gates inside addReaction reflect who is reacting.
          const callerActor = {
            principalId: auth.principalId,
            role: auth.role as Role,
            principalType:
              callerRecord?.type === 'service' ? ('service' as const) : ('user' as const),
            segmentIds: callerSegmentIds,
          }

          const result = await addReaction(
            commentId,
            parsed.data.emoji,
            auth.principalId,
            callerActor
          )

          return successResponse({
            commentId,
            emoji: parsed.data.emoji,
            added: result.added,
            reactions: result.reactions,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/comments/:commentId/reactions
       * Remove an emoji reaction from a comment, attributed to the API key's principal.
       * Accepts the emoji in the JSON body or as an `emoji` query parameter.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })

          const commentId = parseTypeId<CommentId>(params.commentId, 'comment', 'comment ID')

          // Accept emoji from the query string (no body) or a JSON body.
          const queryEmoji = new URL(request.url).searchParams.get('emoji')
          let rawEmoji: unknown = queryEmoji ?? undefined
          if (rawEmoji === undefined) {
            const body = await request.json().catch(() => ({}))
            rawEmoji = (body as { emoji?: unknown }).emoji
          }

          const parsed = reactionSchema.safeParse({ emoji: rawEmoji })

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { removeReaction } = await import('@/lib/server/domains/comments/comment.reactions')
          const { segmentIdsForPrincipal } =
            await import('@/lib/server/domains/segments/segment-membership.service')
          const { db, principal, eq } = await import('@/lib/server/db')

          const [callerSegmentIds, callerRecord] = await Promise.all([
            segmentIdsForPrincipal(auth.principalId),
            db.query.principal.findFirst({
              where: eq(principal.id, auth.principalId),
              columns: { type: true },
            }),
          ])

          const callerActor = {
            principalId: auth.principalId,
            role: auth.role as Role,
            principalType:
              callerRecord?.type === 'service' ? ('service' as const) : ('user' as const),
            segmentIds: callerSegmentIds,
          }

          const result = await removeReaction(
            commentId,
            parsed.data.emoji,
            auth.principalId,
            callerActor
          )

          return successResponse({
            commentId,
            emoji: parsed.data.emoji,
            added: result.added,
            reactions: result.reactions,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
