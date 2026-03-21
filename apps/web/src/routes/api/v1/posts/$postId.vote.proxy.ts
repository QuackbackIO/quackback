import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import type { PostId, PrincipalId } from '@quackback/ids'

const bodySchema = z.object({
  voterPrincipalId: z.string().min(1, 'Voter principal ID is required'),
  createdAt: z.string().datetime().optional(),
})

export const Route = createFileRoute('/api/v1/posts/$postId/vote/proxy')({
  server: {
    handlers: {
      /**
       * POST /api/v1/posts/:postId/vote/proxy
       * Add a proxy vote on behalf of a user (insert-only, never toggles)
       */
      POST: async ({ request, params }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult
        const { principalId: addedByPrincipalId } = authResult

        try {
          const { postId } = params

          const postError = validateTypeId(postId, 'post', 'post ID')
          if (postError) return postError

          const body = await request.json().catch(() => null)
          const parsed = bodySchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { voterPrincipalId } = parsed.data
          const voterError = validateTypeId(voterPrincipalId, 'principal', 'voter principal ID')
          if (voterError) return voterError

          // Only admins can set createdAt (for imports)
          const createdAt =
            parsed.data.createdAt && authResult.role === 'admin'
              ? new Date(parsed.data.createdAt)
              : undefined

          const { addVoteOnBehalf } = await import('@/lib/server/domains/posts/post.voting')
          const { createActivity } = await import('@/lib/server/domains/activity/activity.service')
          const result = await addVoteOnBehalf(
            postId as PostId,
            voterPrincipalId as PrincipalId,
            { type: 'proxy', externalUrl: '' },
            null,
            addedByPrincipalId,
            createdAt
          )

          if (result.voted && !authResult.importMode) {
            createActivity({
              postId: postId as PostId,
              principalId: addedByPrincipalId,
              type: 'vote.proxy',
              metadata: { voterPrincipalId },
            })
          }

          return successResponse({
            voted: result.voted,
            voteCount: result.voteCount,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/posts/:postId/vote/proxy
       * Remove a vote on behalf of a user
       */
      DELETE: async ({ request, params }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult
        const { principalId: removedByPrincipalId } = authResult

        try {
          const { postId } = params

          const postError = validateTypeId(postId, 'post', 'post ID')
          if (postError) return postError

          const body = await request.json().catch(() => null)
          const parsed = bodySchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { voterPrincipalId } = parsed.data
          const voterError = validateTypeId(voterPrincipalId, 'principal', 'voter principal ID')
          if (voterError) return voterError

          const { removeVote } = await import('@/lib/server/domains/posts/post.voting')
          const { createActivity } = await import('@/lib/server/domains/activity/activity.service')
          const result = await removeVote(postId as PostId, voterPrincipalId as PrincipalId)

          if (result.removed) {
            createActivity({
              postId: postId as PostId,
              principalId: removedByPrincipalId,
              type: 'vote.removed',
              metadata: { voterPrincipalId },
            })
          }

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
