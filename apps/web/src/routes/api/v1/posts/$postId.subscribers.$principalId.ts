import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { handleDomainError, noContentResponse } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { serviceActorFromApiAuth } from '@/lib/server/domains/api/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PostId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/posts/$postId/subscribers/$principalId')({
  server: {
    handlers: {
      /** DELETE /api/v1/posts/:postId/subscribers/:principalId — unsubscribe
       *  someone from the post's thread. 204 whether or not they followed it. */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await withApiKeyAuth(request, {
            permission: PERMISSIONS.POST_VOTE_ON_BEHALF,
          })
          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')
          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'subscriber principal ID'
          )
          const { removePostSubscriber } =
            await import('@/lib/server/domains/posts/post.subscribers')
          await removePostSubscriber(postId, principalId, serviceActorFromApiAuth(auth))
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
