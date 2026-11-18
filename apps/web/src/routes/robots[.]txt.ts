import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [
          { isFeatureEnabled, getHelpCenterConfig },
          { getSectionOrigins },
          { sectionServedAt },
          { requestWorkspaceHost },
        ] = await Promise.all([
          import('@/lib/server/domains/settings/settings.service'),
          import('@/lib/server/domains/settings/section-links'),
          import('@/lib/shared/section-links'),
          import('@/lib/server/workspaces/saas-edge-host'),
        ])

        const [helpCenterConfig, helpCenterEnabled, origins] = await Promise.all([
          getHelpCenterConfig(),
          isFeatureEnabled('helpCenter'),
          getSectionOrigins(),
        ])
        // Indexing toggle (domains/languages §1): off means neither crawlable
        // nor advertised via a sitemap link.
        const helpCenterIndexable = helpCenterEnabled && helpCenterConfig.seo?.indexable !== false
        // Each host advertises its own sitemaps: a section on its own host
        // (help.acme.com) lists that section's, the primary domain the rest.
        const hostSection = sectionServedAt(requestWorkspaceHost(request), origins)

        const lines =
          hostSection === 'help' && !helpCenterIndexable
            ? ['User-agent: *', 'Disallow: /']
            : [
                'User-agent: *',
                'Allow: /',
                'Disallow: /admin/',
                'Disallow: /auth/',
                'Disallow: /onboarding/',
                'Disallow: /api/',
                'Disallow: /widget',
                ...(helpCenterEnabled && !helpCenterIndexable ? ['Disallow: /hc'] : []),
                '',
                ...sitemapLines(),
              ]

        function sitemapLines(): string[] {
          if (hostSection === 'help') return [`Sitemap: ${origins.help}/hc/sitemap.xml`]
          if (hostSection) return [`Sitemap: ${origins[hostSection]}/sitemap.xml`]
          const helpHere = origins.help === origins.primary && helpCenterIndexable
          return [
            `Sitemap: ${origins.primary}/sitemap.xml`,
            ...(helpHere ? [`Sitemap: ${origins.primary}/hc/sitemap.xml`] : []),
          ]
        }

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
