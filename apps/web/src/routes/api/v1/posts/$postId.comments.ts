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
        const authResult = await withApiKeyAuth(request, { role: 'team' })
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
            principalId: c.principalId,
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
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult
        const { principalId } = authResult

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
          const { db, principal, eq } = await import('@/lib/server/db')

          // Get member info for author details
          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.id, principalId),
            with: { user: true },
          })

          if (!principalRecord?.user) {
            return badRequestResponse('Member not found')
          }

          const result = await createComment(
            {
              postId: postId as PostId,
              content: parsed.data.content,
              parentId: parsed.data.parentId as CommentId | undefined,
            },
            {
              principalId,
              userId: principalRecord.user.id as UserId,
              name: principalRecord.user.name,
              email: principalRecord.user.email,
              role: principalRecord.role as 'admin' | 'member' | 'user',
            }
          )

          return createdResponse({
            id: result.comment.id,
            postId: result.comment.postId,
            parentId: result.comment.parentId,
            content: result.comment.content,
            authorName: principalRecord.user.name,
            principalId: result.comment.principalId,
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
