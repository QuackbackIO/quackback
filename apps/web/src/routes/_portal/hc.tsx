import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'
import type { HelpCenterConfig } from '@/lib/server/domains/settings'

export const Route = createFileRoute('/_portal/hc')({
  beforeLoad: ({ context }) => {
    const { settings } = context

    const flags = settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    if (!helpCenterConfig?.enabled) throw notFound()
  },
  loader: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = (settings?.helpCenterConfig as HelpCenterConfig | null) ?? null
    return { helpCenterConfig }
  },
  head: () => {
    return { meta: [] }
  },
  component: HelpCenterLayoutRoute,
})

function HelpCenterLayoutRoute() {
  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
