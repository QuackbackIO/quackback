import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import type { MemberId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/users/$memberId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/users/:memberId
       * Get a single portal user by member ID
       */
      GET: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { memberId } = params

          // Validate TypeID format
          const validationError = validateTypeId(memberId, 'member', 'member ID')
          if (validationError) return validationError

          // Import service function
          const { getPortalUserDetail } = await import('@/lib/server/domains/users/user.service')

          const user = await getPortalUserDetail(memberId as MemberId)

          if (!user) {
            return notFoundResponse('Portal user not found')
          }

          return successResponse({
            memberId: user.memberId,
            userId: user.userId,
            name: user.name,
            email: user.email,
            image: user.image,
            emailVerified: user.emailVerified,
            joinedAt: user.joinedAt.toISOString(),
            createdAt: user.createdAt.toISOString(),
            postCount: user.postCount,
            commentCount: user.commentCount,
            voteCount: user.voteCount,
            engagedPosts: user.engagedPosts.map((post) => ({
              id: post.id,
              title: post.title,
              content: post.content,
              statusId: post.statusId,
              statusName: post.statusName,
              statusColor: post.statusColor,
              voteCount: post.voteCount,
              commentCount: post.commentCount,
              boardSlug: post.boardSlug,
              boardName: post.boardName,
              authorName: post.authorName,
              createdAt: post.createdAt.toISOString(),
              engagementTypes: post.engagementTypes,
              engagedAt: post.engagedAt.toISOString(),
            })),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/users/:memberId
       * Remove a portal user
       */
      DELETE: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { memberId } = params

          // Validate TypeID format
          const validationError = validateTypeId(memberId, 'member', 'member ID')
          if (validationError) return validationError

          // Import service function
          const { removePortalUser } = await import('@/lib/server/domains/users/user.service')

          await removePortalUser(memberId as MemberId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
