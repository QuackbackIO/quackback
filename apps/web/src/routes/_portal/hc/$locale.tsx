import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'

/**
 * Locale-prefixed /hc subtree (domains/languages §2): `/hc/{locale}/...`.
 * The default locale stays unprefixed (served by the sibling routes at
 * /hc/categories/*, /hc/articles/*), so this only ever matches an
 * ADDITIONAL, currently-enabled locale -- anything else 404s rather than
 * silently falling back, since a disabled/unknown locale has no translated
 * content to show.
 */
export const Route = createFileRoute('/_portal/hc/$locale')({
  beforeLoad: ({ context, params }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const additional = helpCenterConfig?.locales?.additional ?? []
    if (!additional.includes(params.locale)) throw notFound()
  },
  component: () => <Outlet />,
})
