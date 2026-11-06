import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: async () => {
        const [
          { config },
          { isFeatureEnabled, getHelpCenterConfig },
          { resolveHelpCenterPublicBaseUrl },
        ] = await Promise.all([
          import('@/lib/server/config'),
          import('@/lib/server/domains/settings/settings.service'),
          import('@/lib/shared/help-center-domain'),
        ])
        const baseUrl = config.baseUrl

        const helpCenterConfig = await getHelpCenterConfig()
        const helpCenterEnabled = await isFeatureEnabled('helpCenter')
        // Indexing toggle (domains/languages §1): off means neither crawlable
        // nor advertised via a sitemap link.
        const helpCenterIndexable = helpCenterEnabled && helpCenterConfig.seo?.indexable !== false
        // The default host's /hc/sitemap.xml redirects to a verified custom domain,
        // so the sitemap is advertised on that domain directly.
        const helpCenterBaseUrl = resolveHelpCenterPublicBaseUrl({
          domainConfig: helpCenterConfig.domain,
          fallback: baseUrl,
        })

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
          ...(helpCenterIndexable ? [`Sitemap: ${helpCenterBaseUrl}/hc/sitemap.xml`] : []),
        ]
        const body = lines.join('\n') + '\n'

        return new Response(body, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
            Vary: 'Host',
          },
        })
      },
    },
  },
})
