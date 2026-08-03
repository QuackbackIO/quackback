import { createFileRoute, notFound, Outlet, redirect } from '@tanstack/react-router'
import type { FeatureFlags, HelpCenterConfig } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/_portal/hc')({
  beforeLoad: ({ context }) => {
    // Check if helpCenter tab is enabled for the user
    const parentData = context as any
    const enabledTabs = parentData.enabledTabs || {}
    if (enabledTabs.helpCenter === false) {
      throw redirect({ to: '/' })
    }

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
