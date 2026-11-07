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
    from: z.enum(['portal', 'appearance']).optional().catch(undefined),
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
    const { portalDesignQueries } = await import('@/lib/client/queries/portal-design')
    await Promise.all([
      context.queryClient.ensureQueryData(portalDesignQueries.editor()),
      context.queryClient.ensureQueryData(portalDesignQueries.aiStatus()),
    ])
  },
  // The workspace's icon, as the portal shows it; without one the browser asks for /favicon.ico.
  head: ({ match }) => {
    const settings = match.context.settings
    return {
      meta: [{ title: 'Customise' }, { name: 'robots', content: 'noindex, nofollow' }],
      links: [
        {
          rel: 'icon',
          href: settings?.faviconData?.url || settings?.brandingData?.logoUrl || '/logo.png',
        },
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
