import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
  decodeCursor,
  encodeCursor,
} from '@/lib/server/domains/api/responses'
import {
  validateTypeId,
  validateOptionalTypeId,
  validateTypeIdArray,
} from '@/lib/server/domains/api/validation'
import type { BoardId, StatusId, TagId } from '@quackback/ids'

// Input validation schemas
const createPostSchema = z.object({
  boardId: z.string().min(1, 'Board ID is required'),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000).optional().default(''),
  statusId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
})

export const Route = createFileRoute('/api/v1/posts/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/posts
       * List posts with optional filtering and pagination
       */
      GET: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const url = new URL(request.url)

          // Parse pagination (cursor-based)
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
          )
          const offset = decodeCursor(cursor)
          const page = Math.floor(offset / limit) + 1

          // Parse filters
          const boardIdParam = url.searchParams.get('boardId') ?? undefined
          const statusSlug = url.searchParams.get('status') ?? undefined
          const tagIdsParam = url.searchParams.get('tagIds') ?? undefined
          const search = url.searchParams.get('search') ?? undefined
          const sort = (url.searchParams.get('sort') as 'newest' | 'oldest' | 'votes') ?? 'newest'

          // Validate boardId filter if provided
          const { isValidTypeId } = await import('@quackback/ids')
          const boardId =
            boardIdParam && isValidTypeId(boardIdParam, 'board')
              ? (boardIdParam as BoardId)
              : undefined

          // Import service function
          const { listInboxPosts } = await import('@/lib/server/domains/posts/post.query')

          // Convert comma-separated tagIds to array (filter out invalid ones)
          const tagIdArray = tagIdsParam
            ? (tagIdsParam.split(',').filter((id) => id && isValidTypeId(id, 'tag')) as TagId[])
            : undefined

          // Fetch posts
          const result = await listInboxPosts({
            boardIds: boardId ? [boardId] : undefined,
            statusSlugs: statusSlug ? [statusSlug] : undefined,
            tagIds: tagIdArray,
            search,
            sort,
            limit,
            page,
          })

          // Calculate next cursor
          const nextOffset = offset + result.items.length
          const nextCursor = result.hasMore ? encodeCursor(nextOffset) : null

          return successResponse(
            result.items.map((post) => ({
              id: post.id,
              title: post.title,
              content: post.content,
              voteCount: post.voteCount,
              commentCount: post.commentCount,
              boardId: post.boardId,
              boardSlug: post.board?.slug,
              boardName: post.board?.name,
              statusId: post.statusId,
              authorName: post.authorName ?? null,
              ownerId: post.ownerPrincipalId,
              tags: post.tags?.map((t) => ({ id: t.id, name: t.name, color: t.color })) ?? [],
              createdAt: post.createdAt.toISOString(),
              updatedAt: post.updatedAt.toISOString(),
            })),
            {
              pagination: {
                cursor: nextCursor,
                hasMore: result.hasMore,
                total: result.total,
              },
            }
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/posts
       * Create a new post
       */
      POST: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult
        const { principalId } = authResult

        try {
          // Parse and validate body
          const body = await request.json()
          const parsed = createPostSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Validate TypeID formats in request body
          let validationError = validateTypeId(parsed.data.boardId, 'board', 'board ID')
          if (validationError) return validationError
          validationError = validateOptionalTypeId(parsed.data.statusId, 'status', 'status ID')
          if (validationError) return validationError
          validationError = validateTypeIdArray(parsed.data.tagIds, 'tag', 'tag IDs')
          if (validationError) return validationError

          // Import service and get principal details
          const { createPost } = await import('@/lib/server/domains/posts/post.service')
          const { db, principal, eq } = await import('@/lib/server/db')

          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.id, principalId),
            columns: { id: true, displayName: true, type: true },
            with: { user: { columns: { id: true, name: true, email: true } } },
          })

          if (!principalRecord) {
            return badRequestResponse('Principal not found')
          }

          const result = await createPost(
            {
              boardId: parsed.data.boardId as BoardId,
              title: parsed.data.title,
              content: parsed.data.content,
              statusId: parsed.data.statusId as StatusId | undefined,
              tagIds: parsed.data.tagIds as TagId[] | undefined,
            },
            {
              principalId,
              userId: principalRecord.user?.id,
              displayName: principalRecord.displayName ?? undefined,
              name: principalRecord.user?.name,
              email: principalRecord.user?.email,
            }
          )

          // Events are dispatched by the service layer

          return createdResponse({
            id: result.id,
            title: result.title,
            content: result.content,
            voteCount: result.voteCount,
            boardId: result.boardId,
            statusId: result.statusId,
            authorName: principalRecord.displayName ?? principalRecord.user?.name ?? null,
            createdAt: result.createdAt.toISOString(),
            updatedAt: result.updatedAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
