import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { realEmail } from '@/lib/shared/anonymous-email'
import { withApiKeyAuth, assertApiPermissions } from '@/lib/server/domains/api/auth'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import {
  parseTypeId,
  parseOptionalTypeId,
  parseTypeIdArray,
} from '@/lib/server/domains/api/validation'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { PostId, PostStatusId, PostTagId, PrincipalId } from '@quackback/ids'
import type { MergedPostSummary } from '@/lib/server/domains/posts/post.types'

// Input validation schema
const updatePostSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(10000).optional(),
  statusId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  ownerPrincipalId: z.string().nullable().optional(),
})

/** Every granular permission a posts PATCH body implies; the caller must hold all of them. */
function permissionsForPostPatch(body: z.infer<typeof updatePostSchema>): PermissionKey[] {
  const perms: PermissionKey[] = []
  if (body.title !== undefined || body.content !== undefined) perms.push(PERMISSIONS.POST_EDIT)
  if (body.statusId !== undefined) perms.push(PERMISSIONS.POST_SET_STATUS)
  if (body.tagIds !== undefined) perms.push(PERMISSIONS.POST_SET_TAGS)
  if (body.ownerPrincipalId !== undefined) perms.push(PERMISSIONS.POST_SET_OWNER)
  return perms
}

export const Route = createFileRoute('/api/v1/posts/$postId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/posts/:postId
       * Get a single post by ID
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.POST_VIEW_PRIVATE })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const { getPostWithDetails } = await import('@/lib/server/domains/posts/post.query')
          const { getMergedPosts } = await import('@/lib/server/domains/posts/post.merge')

          const [post, mergedPosts] = await Promise.all([
            getPostWithDetails(postId),
            getMergedPosts(postId),
          ])

          return successResponse({
            id: post.id,
            title: post.title,
            content: contentJsonToMarkdown(post.contentJson, post.content),
            contentJson: post.contentJson,
            voteCount: post.voteCount,
            commentCount: post.commentCount,
            boardId: post.boardId,
            boardSlug: post.board?.slug,
            boardName: post.board?.name,
            statusId: post.statusId,
            authorName: post.authorName ?? null,
            authorEmail: realEmail(post.authorEmail),
            ownerPrincipalId: post.ownerPrincipalId,
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
            summaryJson: post.summaryJson ?? null,
            summaryUpdatedAt: post.summaryUpdatedAt?.toISOString() ?? null,
            canonicalPostId: post.canonicalPostId ?? null,
            mergedAt: post.mergedAt?.toISOString() ?? null,
            isCommentsLocked: post.isCommentsLocked,
            mergedPosts: mergedPosts.map((mp: MergedPostSummary) => ({
              id: mp.id,
              title: mp.title,
              voteCount: mp.voteCount,
              authorName: mp.authorName,
              createdAt: mp.createdAt.toISOString(),
              mergedAt: mp.mergedAt.toISOString(),
            })),
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
        try {
          const auth = await withApiKeyAuth(request)

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const body = await request.json()
          const parsed = updatePostSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // The PATCH body can touch several permission-scoped fields; require the
          // granular permission for each field actually present.
          assertApiPermissions(auth, permissionsForPostPatch(parsed.data))

          const statusId = parseOptionalTypeId<PostStatusId>(
            parsed.data.statusId,
            'status',
            'status ID'
          )
          const tagIds =
            parsed.data.tagIds !== undefined
              ? parseTypeIdArray<PostTagId>(parsed.data.tagIds, 'post_tag', 'tag IDs')
              : undefined

          const { updatePost } = await import('@/lib/server/domains/posts/post.service')

          const result = await updatePost(
            postId,
            {
              title: parsed.data.title,
              content: parsed.data.content,
              statusId,
              tagIds,
              ownerPrincipalId: parsed.data.ownerPrincipalId as PrincipalId | null | undefined,
            },
            {
              principalId: auth.principalId,
              displayName: auth.apiKey.name,
            }
          )

          return successResponse({
            id: result.id,
            title: result.title,
            content: contentJsonToMarkdown(result.contentJson, result.content),
            contentJson: result.contentJson,
            voteCount: result.voteCount,
            boardId: result.boardId,
            statusId: result.statusId,
            ownerPrincipalId: result.ownerPrincipalId,
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
        try {
          const { principalId, role } = await withApiKeyAuth(request, {
            permission: PERMISSIONS.POST_DELETE,
          })

          const postId = parseTypeId<PostId>(params.postId, 'post', 'post ID')

          const { softDeletePost } = await import('@/lib/server/domains/posts/post.user-actions')

          await softDeletePost(postId, { principalId, role })

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
