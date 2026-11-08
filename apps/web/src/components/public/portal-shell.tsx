import { useRouteContext, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { PortalErrorContext } from '@/components/shared/error-page'
import { backgroundPageOf, locationOfPath } from '@/lib/shared/design/paths'
import { usePreviewDesignNav } from './preview-draft-context'

// Only a missing page draws it, so a page that is found never loads it (nor the
// search field it holds, which would split into one more script on every page).
const LazyNotFound = lazy(() =>
  import('./portal-not-found').then((m) => ({ default: m.PortalNotFound }))
)
function PortalNotFound() {
  return (
    <Suspense fallback={null}>
      <LazyNotFound />
    </Suspense>
  )
}

/** A turned-off page's sample, which the builder shows at /design-sample/<page>. */
const SAMPLE = /^\/design-sample\/([a-z-]+)/

/** The page a portal path shows, as page backgrounds name it, or null for one they do not. */
export function shellPageOf(pathname: string, homeOn: boolean): string | null {
  const sample = SAMPLE.exec(pathname)?.[1]
  if (sample) return backgroundPageOf(sample)
  return backgroundPageOf(locationOfPath(pathname, homeOn)?.page)
}

/**
 * The portal's page shell. It names the page it shows (`data-qb-page`), so
 * a page with a background of its own draws it; the design's CSS paints the
 * background, and pages without one show the page colour as before.
 */
export function PortalShell({ children }: { children: ReactNode }) {
  const savedHomeOn = useRouteContext({
    from: '__root__',
    select: (context) =>
      context.settings?.portalDesign?.engine === 'v2'
        ? context.settings.portalDesign.nav.home.on
        : false,
  })
  const draftNav = usePreviewDesignNav()
  const homeOn = draftNav ? draftNav.home.on : savedHomeOn
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const page = shellPageOf(pathname, homeOn)
  // An error or a missing page inside the shell shows the brand's icon, or none.
  const icon = useRouteContext({
    from: '__root__',
    select: (context) => {
      const design = context.settings?.portalDesign
      const mark = design?.engine === 'v2' ? design.logo.mark : undefined
      return mark?.light ?? mark?.dark ?? null
    },
  })
  const errors = useMemo(() => ({ icon, NotFound: PortalNotFound }), [icon])
  return (
    <div
      data-portal=""
      data-qb-page={page ?? undefined}
      className="min-h-screen bg-background flex flex-col"
    >
      <PortalErrorContext.Provider value={errors}>{children}</PortalErrorContext.Provider>
    </div>
  )
}
