import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: async () => {
        const [{ config }, { isFeatureEnabled, getHelpCenterConfig }] = await Promise.all([
          import('@/lib/server/config'),
          import('@/lib/server/domains/settings/settings.service'),
        ])
        const baseUrl = config.baseUrl

        const helpCenterConfig = await getHelpCenterConfig()
        const helpCenterEnabled = (await isFeatureEnabled('helpCenter')) && helpCenterConfig.enabled
        // Indexing toggle (domains/languages §1): off means neither crawlable
        // nor advertised via a sitemap link.
        const helpCenterIndexable = helpCenterEnabled && helpCenterConfig.seo?.indexable !== false

        const lines = [
          'User-agent: *',
          'Allow: /',
          'Disallow: /admin/',
          'Disallow: /auth/',
          'Disallow: /onboarding/',
          'Disallow: /api/',
          'Disallow: /widget',
          ...(helpCenterEnabled && !helpCenterIndexable ? ['Disallow: /hc'] : []),
          '',
          `Sitemap: ${baseUrl}/sitemap.xml`,
          ...(helpCenterIndexable ? [`Sitemap: ${baseUrl}/hc/sitemap.xml`] : []),
        ]
        const body = lines.join('\n') + '\n'

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
