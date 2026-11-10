import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { DesignerShell } from '@/components/designer/designer-shell'
import { useDesignerVisit } from '@/components/designer/use-designer-events'
import { getDesignerAccessFn } from '@/lib/server/functions/portal-designer'
import { designerReturnPath } from '@/lib/shared/design/designer-path'

/**
 * The portal designer, for people who may change the portal's branding while
 * the Portal designer Labs switch is on. Anyone else is sent to sign in, or
 * back to the portal page they came from.
 */
export const Route = createFileRoute('/design')({
  validateSearch: z.object({
    path: z.string().optional(),
    /** Where the builder was opened from, for product analytics. */
    from: z.enum(['portal', 'appearance', 'onboarding']).optional().catch(undefined),
    /** A website to match the brand from on arrival, as onboarding's branding step links it. */
    match: z.string().max(253).optional().catch(undefined),
    /** `match`: open the Brand kit at its match row, as Settings > Portal's Match your brand links it. */
    brand: z.literal('match').optional().catch(undefined),
    /** `open`: open publish, as onboarding's branding step links it while a matched brand waits in the draft. */
    publish: z.literal('open').optional().catch(undefined),
  }),
  beforeLoad: async ({ search, context }) => {
    const returnPath = designerReturnPath(search.path)
    const access = await getDesignerAccessFn()
    if (!access.ok && access.reason === 'sign-in') {
      throw redirect({
        to: '/admin/login',
        search: { callbackUrl: `/design?path=${encodeURIComponent(returnPath)}` },
      })
    }
    if (!access.ok || context.settings?.portalDesign?.engine !== 'v2') {
      throw redirect({ href: returnPath })
    }
    return { returnPath }
  },
  loader: async ({ context }) => {
    // Loaded here, not imported above: a loader's imports ship in the entry chunk.
    const { loadDesignerRoute } = await import('@/lib/client/designer-route-data')
    return loadDesignerRoute(context.queryClient, context.settings, context.returnPath)
  },
  // The workspace's icon, as the portal shows it; without one the browser asks for /favicon.ico.
  head: ({ match, loaderData }) => {
    const settings = match.context.settings
    return {
      meta: [{ title: 'Customise' }, { name: 'robots', content: 'noindex, nofollow' }],
      links: [
        {
          rel: 'icon',
          href: settings?.faviconData?.url || settings?.brandingData?.logoUrl || '/logo.png',
        },
        // The canvas's first page, fetched now and taken from the cache when the canvas asks.
        ...(loaderData?.canvas
          ? [{ rel: 'prefetch', href: loaderData.canvas, as: 'document' }]
          : []),
      ],
    }
  },
  component: DesignerPage,
})

function DesignerPage() {
  const { returnPath, settings } = Route.useRouteContext()
  useDesignerVisit(Route.useSearch().from ?? 'direct')
  return (
    <DesignerShell
      returnPath={returnPath}
      workspaceName={settings?.name ?? ''}
      logoUrl={settings?.brandingData?.logoUrl ?? null}
    />
  )
}
