import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
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
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })
          const { principalId: addedByPrincipalId } = auth

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const body = await request.json().catch(() => null)
          const parsed = bodySchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const voterPrincipalId = parseTypeId<PrincipalId>(
            parsed.data.voterPrincipalId,
            'principal',
            'voter principal ID'
          )

          // Only admins can set createdAt (for imports)
          const createdAt =
            parsed.data.createdAt && auth.role === 'admin'
              ? new Date(parsed.data.createdAt)
              : undefined

          const { addVoteOnBehalf } = await import('@/lib/server/domains/posts/post.voting')
          const { createActivity } = await import('@/lib/server/domains/activity/activity.service')
          const result = await addVoteOnBehalf(
            postId,
            voterPrincipalId,
            { type: 'proxy', externalUrl: '' },
            null,
            addedByPrincipalId,
            createdAt
          )

          if (result.voted && !auth.importMode) {
            createActivity({
              postId,
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
        try {
          const { principalId: removedByPrincipalId } = await withApiKeyAuth(request, { role: 'team' })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const body = await request.json().catch(() => null)
          const parsed = bodySchema.safeParse(body)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const voterPrincipalId = parseTypeId<PrincipalId>(
            parsed.data.voterPrincipalId,
            'principal',
            'voter principal ID'
          )

          const { removeVote } = await import('@/lib/server/domains/posts/post.voting')
          const { createActivity } = await import('@/lib/server/domains/activity/activity.service')
          const result = await removeVote(postId, voterPrincipalId)

          if (result.removed) {
            createActivity({
              postId,
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
