import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'

/**
 * Locale-prefixed /hc subtree: `/hc/{locale}/...`.
 * Article and collection URLs always include the locale, including the
 * default (`/hc/en/articles/...`). Unknown locales 404.
 */
export const Route = createFileRoute('/_portal/hc/$locale')({
  beforeLoad: ({ context, params }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const additional = helpCenterConfig?.locales?.additional ?? []
    const defaultLocale = helpCenterConfig?.locales?.default ?? 'en'
    if (params.locale !== defaultLocale && !additional.includes(params.locale)) {
      throw notFound()
    }
  },
  component: () => <Outlet />,
})
