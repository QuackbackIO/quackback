import { useRouteContext, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { backgroundPageOf } from '@/lib/shared/design/page-background'
import { locationOfPath } from '@/lib/shared/design/outline'
import { usePreviewDesignNav } from './preview-draft-context'

/** A turned-off page's sample, which the builder shows at /design-sample/<page>. */
const SAMPLE = /^\/design-sample\/([a-z]+)/

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
  return (
    <div
      data-portal=""
      data-qb-page={page ?? undefined}
      className="min-h-screen bg-background flex flex-col"
    >
      {children}
    </div>
  )
}
