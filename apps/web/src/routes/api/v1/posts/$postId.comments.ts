import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId, validateOptionalTypeId } from '@/lib/server/domains/api/validation'
import type { PostId, CommentId, UserId } from '@quackback/ids'

// Input validation schema
const createCommentSchema = z.object({
  content: z.string().min(1, 'Content is required').max(5000),
  parentId: z.string().optional().nullable(),
})

export const Route = createFileRoute('/api/v1/posts/$postId/comments')({
  server: {
    handlers: {
      /**
       * GET /api/v1/posts/:postId/comments
       * List comments for a post (threaded)
       */
      GET: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { postId } = params

          // Validate TypeID format
          const validationError = validateTypeId(postId, 'post', 'post ID')
          if (validationError) return validationError

          // Import service function
          const { getCommentsWithReplies } = await import('@/lib/server/domains/posts/post.query')

          const comments = await getCommentsWithReplies(postId as PostId)

          // Transform to API response format
          const serializeComment = (c: (typeof comments)[0]): unknown => ({
            id: c.id,
            postId: c.postId,
            parentId: c.parentId,
            content: c.content,
            authorName: c.authorName,
            memberId: c.memberId,
            isTeamMember: c.isTeamMember,
            createdAt: c.createdAt.toISOString(),
            reactions: c.reactions,
            replies: c.replies.map(serializeComment),
          })

          return successResponse(comments.map(serializeComment))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/posts/:postId/comments
       * Create a comment on a post
       */
      POST: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult
        const { memberId } = authResult

        try {
          const { postId } = params

          // Validate TypeID format
          const validationError = validateTypeId(postId, 'post', 'post ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = createCommentSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Validate TypeID format in request body
          const bodyValidationError = validateOptionalTypeId(
            parsed.data.parentId,
            'comment',
            'parent ID'
          )
          if (bodyValidationError) return bodyValidationError

          // Import service and get member details
          const { createComment } = await import('@/lib/server/domains/comments/comment.service')
          const { db, member, eq } = await import('@/lib/db')

          // Get member info for author details
          const memberRecord = await db.query.member.findFirst({
            where: eq(member.id, memberId),
            with: { user: true },
          })

          if (!memberRecord?.user) {
            return badRequestResponse('Member not found')
          }

          const result = await createComment(
            {
              postId: postId as PostId,
              content: parsed.data.content,
              parentId: parsed.data.parentId as CommentId | undefined,
            },
            {
              memberId,
              userId: memberRecord.user.id as UserId,
              name: memberRecord.user.name,
              email: memberRecord.user.email,
              role: memberRecord.role as 'admin' | 'member' | 'user',
            }
          )

          return createdResponse({
            id: result.comment.id,
            postId: result.comment.postId,
            parentId: result.comment.parentId,
            content: result.comment.content,
            authorName: result.comment.authorName,
            memberId: result.comment.memberId,
            isTeamMember: result.comment.isTeamMember,
            createdAt: result.comment.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
