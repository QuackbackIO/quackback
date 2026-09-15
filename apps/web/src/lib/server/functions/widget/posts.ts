/**
 * Widget BFF for posts. Portal keeps public-posts.ts; widget never calls
 * requireAuth() on those handlers.
 */
import { createServerFn } from '@tanstack/react-start'
import {
  listPublicPostsSchema,
  createPublicPostSchema,
  toggleVoteSchema,
  type ListPublicPostsInput,
  type CreatePublicPostInput,
  type ToggleVoteInput,
} from '../public-posts'
import {
  runListPublicPosts,
  runCreatePublicPost,
  runToggleVote,
  runGetVotedPosts,
} from '../public-posts'
import {
  fetchPublicPostDetailSchema,
  runFetchPublicPostDetail,
  runFetchBoardCapabilities,
  type FetchPublicPostDetailInput,
} from '../portal'
import { getOptionalWidgetAuth, requireWidgetAuth } from '../widget-auth'

export const widgetListPublicPostsFn = createServerFn({ method: 'GET' })
  .validator(listPublicPostsSchema)
  .handler(async ({ data }: { data: ListPublicPostsInput }) => {
    return runListPublicPosts(await getOptionalWidgetAuth(), data)
  })

export const widgetCreatePublicPostFn = createServerFn({ method: 'POST' })
  .validator(createPublicPostSchema)
  .handler(async ({ data }: { data: CreatePublicPostInput }) => {
    return runCreatePublicPost(await requireWidgetAuth(), data)
  })

export const widgetToggleVoteFn = createServerFn({ method: 'POST' })
  .validator(toggleVoteSchema)
  .handler(
    async ({ data }: { data: ToggleVoteInput }): Promise<{ voted: boolean; voteCount: number }> => {
      return runToggleVote(await requireWidgetAuth(), data)
    }
  )

export const widgetGetVotedPostsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ votedPostIds: string[] }> => {
    return runGetVotedPosts(await getOptionalWidgetAuth())
  }
)

export const widgetFetchPublicPostDetailFn = createServerFn({ method: 'GET' })
  .validator(fetchPublicPostDetailSchema)
  .handler(async ({ data }: { data: FetchPublicPostDetailInput }) => {
    return runFetchPublicPostDetail(await getOptionalWidgetAuth(), data)
  })

export const widgetFetchBoardCapabilitiesFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    return runFetchBoardCapabilities(await getOptionalWidgetAuth())
  }
)
