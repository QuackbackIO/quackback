import { createFileRoute } from '@tanstack/react-router'

/**
 * The portal's drawn brand images: the share card a link preview shows and
 * the brand icon squared for the favicon (domains/design/share-card). Kept
 * out of /api so crawlers that obey robots.txt can fetch the card.
 */
export const Route = createFileRoute('/brand.png')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ brandImageDeps, serveBrandImage }, { logger }] = await Promise.all([
          import('@/lib/server/domains/design/share-card/serve'),
          import('@/lib/server/logger'),
        ])
        try {
          return await serveBrandImage(new URL(request.url).searchParams, brandImageDeps())
        } catch (err) {
          logger.error({ err, module: 'share-card' }, 'brand image could not be drawn')
          return new Response('Unavailable', {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
          })
        }
      },
    },
  },
})
