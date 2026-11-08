import { createFileRoute } from '@tanstack/react-router'
import { FeedPage } from '@/components/public/feedback/feed-page'
import { portalFeedbackPath } from '@/lib/shared/design/paths'
import {
  feedHead,
  feedSearchSchema,
  loadFeed,
  portalPathsOf,
} from '@/components/public/feedback/feed-route'

export type { FeedSearch } from '@/components/public/feedback/feed-route'

/**
 * The feed. While it is the landing page it also shows at `/`, and its
 * canonical address is the one portalFeedbackPath gives.
 */
export const Route = createFileRoute('/_portal/feedback')({
  validateSearch: feedSearchSchema,
  // Note: No loaderDeps - loader only runs on initial route load for SSR.
  // Client-side filter changes are handled by FeedbackContainer's usePublicPosts.
  // We access search params via location.search for initial SSR without triggering
  // loader re-execution on client-side filter changes.
  loader: async ({ context, location }) => {
    const { settings, gates } = portalPathsOf(context)
    return loadFeed(context, location, portalFeedbackPath(settings, gates))
  },
  head: ({ loaderData, matches }) => feedHead(loaderData, matches),
  component: FeedPage,
})
