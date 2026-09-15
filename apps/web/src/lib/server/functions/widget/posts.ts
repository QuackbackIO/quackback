/**
 * Widget BFF for posts. Keep this file free of static imports from server
 * modules — the client graph loads these createServerFn exports.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { tiptapContentSchema } from '@/lib/shared/schemas/posts'
import { PageLimitSchema } from '@/lib/shared/schemas/taxonomy'

const listPublicPostsSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  statusIds: z.array(z.string()).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('top'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
  minVotes: z.number().int().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid calendar date')
    .optional(),
  responded: z.enum(['responded', 'unresponded']).optional(),
  owner: z.string().optional(),
  segmentIds: z.array(z.string()).optional(),
})

const createPublicPostSchema = z.object({
  boardId: z.string(),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000).optional().default(''),
  contentJson: tiptapContentSchema.optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
})

const toggleVoteSchema = z.object({
  postId: z.string(),
})

const fetchPublicPostDetailSchema = z.object({
  postId: z.string(),
  commentsCursor: z.string().nullish(),
  commentsLimit: PageLimitSchema,
})

export const widgetListPublicPostsFn = createServerFn({ method: 'GET' })
  .validator(listPublicPostsSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runListPublicPosts } = await import('../public-posts')
    return runListPublicPosts(await getOptionalWidgetAuth(), data)
  })

export const widgetCreatePublicPostFn = createServerFn({ method: 'POST' })
  .validator(createPublicPostSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runCreatePublicPost } = await import('../public-posts')
    return runCreatePublicPost(await requireWidgetAuth(), data)
  })

export const widgetToggleVoteFn = createServerFn({ method: 'POST' })
  .validator(toggleVoteSchema)
  .handler(async ({ data }): Promise<{ voted: boolean; voteCount: number }> => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runToggleVote } = await import('../public-posts')
    return runToggleVote(await requireWidgetAuth(), data)
  })

export const widgetGetVotedPostsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ votedPostIds: string[] }> => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runGetVotedPosts } = await import('../public-posts')
    return runGetVotedPosts(await getOptionalWidgetAuth())
  }
)

export const widgetFetchPublicPostDetailFn = createServerFn({ method: 'GET' })
  .validator(fetchPublicPostDetailSchema)
  .handler(async ({ data }) => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runFetchPublicPostDetail } = await import('../portal')
    return runFetchPublicPostDetail(await getOptionalWidgetAuth(), data)
  })

export const widgetFetchBoardCapabilitiesFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getOptionalWidgetAuth } = await import('../widget-auth')
    const { runFetchBoardCapabilities } = await import('../portal')
    return runFetchBoardCapabilities(await getOptionalWidgetAuth())
  }
)
