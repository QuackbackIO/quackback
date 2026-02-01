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
import type { CommentId } from '@quackback/ids'

// Input validation schema
const updateCommentSchema = z.object({
  content: z.string().min(1).max(5000),
})

export const Route = createFileRoute('/api/v1/comments/$commentId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/comments/:commentId
       * Get a single comment by ID
       */
      GET: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { commentId } = params

          // Validate TypeID format
          const validationError = validateTypeId(commentId, 'comment', 'comment ID')
          if (validationError) return validationError

          // Import service function
          const { getCommentById } = await import('@/lib/server/domains/comments/comment.service')

          const comment = await getCommentById(commentId as CommentId)

          return successResponse({
            id: comment.id,
            postId: comment.postId,
            parentId: comment.parentId,
            content: comment.content,
            authorName: comment.authorName,
            authorEmail: comment.authorEmail,
            memberId: comment.memberId,
            isTeamMember: comment.isTeamMember,
            createdAt: comment.createdAt.toISOString(),
            deletedAt: comment.deletedAt?.toISOString() ?? null,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/comments/:commentId
       * Update a comment
       */
      PATCH: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult
        const { memberId } = authResult

        try {
          const { commentId } = params

          // Validate TypeID format
          const validationError = validateTypeId(commentId, 'comment', 'comment ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = updateCommentSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service and get member details
          const { updateComment } = await import('@/lib/server/domains/comments/comment.service')
          const { db, member, eq } = await import('@/lib/server/db')

          // Get member info for role
          const memberRecord = await db.query.member.findFirst({
            where: eq(member.id, memberId),
          })

          const result = await updateComment(
            commentId as CommentId,
            { content: parsed.data.content },
            { memberId, role: (memberRecord?.role as 'admin' | 'member' | 'user') ?? 'user' }
          )

          return successResponse({
            id: result.id,
            postId: result.postId,
            parentId: result.parentId,
            content: result.content,
            authorName: result.authorName,
            memberId: result.memberId,
            isTeamMember: result.isTeamMember,
            createdAt: result.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/comments/:commentId
       * Delete a comment
       */
      DELETE: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult
        const { memberId } = authResult

        try {
          const { commentId } = params

          // Validate TypeID format
          const validationError = validateTypeId(commentId, 'comment', 'comment ID')
          if (validationError) return validationError

          // Import service and get member details
          const { deleteComment } = await import('@/lib/server/domains/comments/comment.service')
          const { db, member, eq } = await import('@/lib/server/db')

          // Get member info for role
          const memberRecord = await db.query.member.findFirst({
            where: eq(member.id, memberId),
          })

          await deleteComment(commentId as CommentId, {
            memberId,
            role: (memberRecord?.role as 'admin' | 'member' | 'user') ?? 'user',
          })

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
