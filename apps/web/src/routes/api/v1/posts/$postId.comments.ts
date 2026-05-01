import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { InternalError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId, parseOptionalTypeId } from '@/lib/server/domains/api/validation'
import type { PostId, CommentId, PrincipalId } from '@quackback/ids'

// Input validation schema
const createCommentSchema = z.object({
  content: z.string().min(1, 'Content is required').max(5000),
  parentId: z.string().optional().nullable(),
  isPrivate: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
  authorPrincipalId: z.string().optional(),
})

export const Route = createFileRoute('/api/v1/posts/$postId/comments')({
  server: {
    handlers: {
      /**
       * GET /api/v1/posts/:postId/comments
       * List comments for a post (threaded)
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const { getCommentsWithReplies } = await import('@/lib/server/domains/posts/post.query')

          const comments = await getCommentsWithReplies(postId)

          const serializeComment = (c: (typeof comments)[0]): unknown => ({
            id: c.id,
            postId: c.postId,
            parentId: c.parentId,
            content: c.content,
            authorName: c.authorName,
            principalId: c.principalId,
            isTeamMember: c.isTeamMember,
            isPrivate: c.isPrivate,
            createdAt: c.createdAt.toISOString(),
            deletedAt: c.deletedAt?.toISOString() ?? null,
            isRemovedByTeam:
              !!c.deletedAt && !!c.deletedByPrincipalId && c.deletedByPrincipalId !== c.principalId,
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
        try {
          const auth = await withApiKeyAuth(request, { role: 'team' })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const body = await request.json()
          const parsed = createCommentSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const parentId = parseOptionalTypeId<CommentId>(
            parsed.data.parentId,
            'comment',
            'parent ID'
          )

          // Admin-only override; mirrors the createdAt gate further down.
          const overridePrincipalId =
            auth.role === 'admin'
              ? parseOptionalTypeId<PrincipalId>(
                  parsed.data.authorPrincipalId,
                  'principal',
                  'authorPrincipalId'
                )
              : undefined
          const targetPrincipalId = overridePrincipalId ?? auth.principalId

          const { createComment } = await import('@/lib/server/domains/comments/comment.service')
          const { db, principal, eq } = await import('@/lib/server/db')

          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.id, targetPrincipalId),
            columns: { id: true, displayName: true, role: true, type: true },
            with: { user: { columns: { id: true, name: true, email: true } } },
          })

          if (!principalRecord) {
            if (overridePrincipalId) {
              throw new NotFoundError(
                'PRINCIPAL_NOT_FOUND',
                `Principal ${targetPrincipalId} not found`
              )
            }
            throw new InternalError(
              'PRINCIPAL_NOT_FOUND',
              'Principal record missing for verified API key'
            )
          }

          if (overridePrincipalId && principalRecord.type === 'service') {
            throw new ValidationError(
              'INVALID_AUTHOR',
              'authorPrincipalId may not reference a service principal'
            )
          }

          // Only admins can set createdAt (for imports)
          const createdAt =
            parsed.data.createdAt && auth.role === 'admin'
              ? new Date(parsed.data.createdAt)
              : undefined

          const result = await createComment(
            {
              postId,
              content: parsed.data.content,
              parentId,
              isPrivate: parsed.data.isPrivate,
              createdAt,
            },
            {
              principalId: targetPrincipalId,
              userId: principalRecord.user?.id,
              displayName: principalRecord.displayName ?? undefined,
              name: principalRecord.user?.name,
              email: principalRecord.user?.email ?? undefined,
              role: principalRecord.role as 'admin' | 'member' | 'user',
            },
            { skipDispatch: auth.importMode }
          )

          return createdResponse({
            id: result.comment.id,
            postId: result.comment.postId,
            parentId: result.comment.parentId,
            content: result.comment.content,
            authorName: principalRecord.displayName ?? principalRecord.user?.name ?? null,
            principalId: result.comment.principalId,
            isTeamMember: result.comment.isTeamMember,
            isPrivate: result.comment.isPrivate,
            createdAt: result.comment.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
