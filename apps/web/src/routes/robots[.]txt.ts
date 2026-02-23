import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: async () => {
        const baseUrl = config.baseUrl

        const body = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /auth/
Disallow: /onboarding/
Disallow: /api/
Disallow: /widget

Sitemap: ${baseUrl}/sitemap.xml
`

        return new Response(body, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
          },
        })
      },
    },
  },
})
