import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import {
  validateTypeId,
  validateOptionalTypeId,
  validateTypeIdArray,
} from '@/lib/server/domains/api/validation'
import type { PostId, StatusId, TagId, MemberId } from '@quackback/ids'

// Input validation schema
const updatePostSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(10000).optional(),
  statusId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  ownerMemberId: z.string().nullable().optional(),
  officialResponse: z.string().nullable().optional(),
})

export const Route = createFileRoute('/api/v1/posts/$postId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/posts/:postId
       * Get a single post by ID
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
          const { getPostWithDetails } = await import('@/lib/server/domains/posts/post.query')

          const post = await getPostWithDetails(postId as PostId)

          return successResponse({
            id: post.id,
            title: post.title,
            content: post.content,
            contentJson: post.contentJson,
            voteCount: post.voteCount,
            commentCount: post.commentCount,
            boardId: post.boardId,
            boardSlug: post.board?.slug,
            boardName: post.board?.name,
            statusId: post.statusId,
            authorName: post.authorName ?? null,
            authorEmail: post.authorEmail ?? null,
            ownerMemberId: post.ownerMemberId,
            officialResponse: post.officialResponse,
            officialResponseAuthorName: post.officialResponseAuthorName ?? null,
            officialResponseAt: post.officialResponseAt?.toISOString() ?? null,
            tags: post.tags?.map((t) => ({ id: t.id, name: t.name, color: t.color })) ?? [],
            roadmapIds: post.roadmapIds,
            pinnedComment: post.pinnedComment
              ? {
                  id: post.pinnedComment.id,
                  content: post.pinnedComment.content,
                  authorName: post.pinnedComment.authorName,
                  createdAt: post.pinnedComment.createdAt.toISOString(),
                }
              : null,
            createdAt: post.createdAt.toISOString(),
            updatedAt: post.updatedAt.toISOString(),
            deletedAt: post.deletedAt?.toISOString() ?? null,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/posts/:postId
       * Update a post
       */
      PATCH: async ({ request, params }) => {
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
          const parsed = updatePostSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Validate TypeID formats in request body
          let bodyValidationError = validateOptionalTypeId(
            parsed.data.statusId,
            'status',
            'status ID'
          )
          if (bodyValidationError) return bodyValidationError
          bodyValidationError = validateTypeIdArray(parsed.data.tagIds, 'tag', 'tag IDs')
          if (bodyValidationError) return bodyValidationError

          // Import service and get member details
          const { updatePost } = await import('@/lib/server/domains/posts/post.service')
          const { db, member, eq } = await import('@/lib/server/db')

          // Get member info for responder details
          const memberRecord = await db.query.member.findFirst({
            where: eq(member.id, memberId),
            with: { user: true },
          })

          const result = await updatePost(
            postId as PostId,
            {
              title: parsed.data.title,
              content: parsed.data.content,
              statusId: parsed.data.statusId as StatusId | undefined,
              tagIds: parsed.data.tagIds as TagId[] | undefined,
              ownerMemberId: parsed.data.ownerMemberId as MemberId | null | undefined,
              officialResponse: parsed.data.officialResponse,
            },
            memberRecord?.user ? { memberId, name: memberRecord.user.name } : undefined
          )

          return successResponse({
            id: result.id,
            title: result.title,
            content: result.content,
            contentJson: result.contentJson,
            voteCount: result.voteCount,
            boardId: result.boardId,
            statusId: result.statusId,
            ownerMemberId: result.ownerMemberId,
            officialResponse: result.officialResponse,
            officialResponseAt: result.officialResponseAt?.toISOString() ?? null,
            createdAt: result.createdAt.toISOString(),
            updatedAt: result.updatedAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/posts/:postId
       * Soft delete a post
       */
      DELETE: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult
        const { memberId } = authResult

        try {
          const { postId } = params

          // Validate TypeID format
          const validationError = validateTypeId(postId, 'post', 'post ID')
          if (validationError) return validationError

          // Import service and get member details
          const { softDeletePost } = await import('@/lib/server/domains/posts/post.permissions')
          const { db, member, eq } = await import('@/lib/server/db')

          // Get member info for role
          const memberRecord = await db.query.member.findFirst({
            where: eq(member.id, memberId),
          })

          await softDeletePost(postId as PostId, {
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
