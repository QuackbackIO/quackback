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
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const commentId = parseTypeId<CommentId>(params.commentId, 'comment', 'comment ID')

          const { getCommentById } = await import('@/lib/server/domains/comments/comment.query')

          const comment = await getCommentById(commentId)

          return successResponse({
            id: comment.id,
            postId: comment.postId,
            parentId: comment.parentId,
            content: comment.content,
            authorName: comment.authorName,
            authorEmail: comment.authorEmail,
            principalId: comment.principalId,
            isTeamMember: comment.isTeamMember,
            isPrivate: comment.isPrivate,
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
        try {
          const { principalId } = await withApiKeyAuth(request, { role: 'team' })

          const commentId = parseTypeId<CommentId>(params.commentId, 'comment', 'comment ID')

          const body = await request.json()
          const parsed = updateCommentSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { userEditComment } = await import(
            '@/lib/server/domains/comments/comment.permissions'
          )
          const { db, principal, eq } = await import('@/lib/server/db')

          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.id, principalId),
            with: { user: { columns: { name: true } } },
          })

          const result = await userEditComment(commentId, parsed.data.content, {
            principalId,
            role: (principalRecord?.role as 'admin' | 'member' | 'user') ?? 'user',
          })

          const commentMember = await db.query.principal.findFirst({
            where: eq(principal.id, result.principalId),
            with: { user: { columns: { name: true } } },
          })

          return successResponse({
            id: result.id,
            postId: result.postId,
            parentId: result.parentId,
            content: result.content,
            authorName: commentMember?.user?.name ?? null,
            principalId: result.principalId,
            isTeamMember: result.isTeamMember,
            isPrivate: result.isPrivate,
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
        try {
          const { principalId } = await withApiKeyAuth(request, { role: 'team' })

          const commentId = parseTypeId<CommentId>(params.commentId, 'comment', 'comment ID')

          const { softDeleteComment } =
            await import('@/lib/server/domains/comments/comment.permissions')
          const { db, principal, eq } = await import('@/lib/server/db')

          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.id, principalId),
          })

          await softDeleteComment(commentId, {
            principalId,
            role: (principalRecord?.role as 'admin' | 'member' | 'user') ?? 'user',
          })

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
