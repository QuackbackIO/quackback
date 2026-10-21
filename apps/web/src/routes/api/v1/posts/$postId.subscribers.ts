import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { serializePostSubscriber } from './-serialize'
import type { PostId, PrincipalId } from '@quackback/ids'

const addSubscriberSchema = z.object({
  principalId: z.string(),
  level: z.enum(['all', 'status_only']).optional(),
})

export const Route = createFileRoute('/api/v1/posts/$postId/subscribers')({
  server: {
    handlers: {
      /** GET /api/v1/posts/:postId/subscribers — who follows the post's thread. */
      GET: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, { permission: PERMISSIONS.POST_VIEW_PRIVATE })
          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')
          const { listPostSubscribers } =
            await import('@/lib/server/domains/posts/post.subscribers')
          const subscribers = await listPostSubscribers(postId, serviceActorFromApiAuth(auth))
          return successResponse(subscribers.map(serializePostSubscriber))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /** POST /api/v1/posts/:postId/subscribers — subscribe someone to the post.
       *  201 when subscribed, 200 when they already followed it. */
      POST: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.POST_VOTE_ON_BEHALF,
          })
          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')
          const parsed = addSubscriberSchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const principalId = parseTypeId<PrincipalId>(
            parsed.data.principalId,
            'principal',
            'principal ID'
          )
          const actor = serviceActorFromApiAuth(auth)
          const { addPostSubscriber, listPostSubscribers } =
            await import('@/lib/server/domains/posts/post.subscribers')
          const { added } = await addPostSubscriber(postId, principalId, actor, {
            level: parsed.data.level,
          })
          const subscribers = (await listPostSubscribers(postId, actor)).map(
            serializePostSubscriber
          )
          return added ? createdResponse(subscribers) : successResponse(subscribers)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
