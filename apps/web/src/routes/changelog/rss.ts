import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/changelog/rss')({
  server: {
    handlers: {
      /**
       * GET /changelog/rss
       * Feed readers probe common feed paths; the feed lives at /changelog/feed.
       */
      GET: () => new Response(null, { status: 308, headers: { location: '/changelog/feed' } }),
    },
  },
})
