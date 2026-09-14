'use client'

import { useMemo } from 'react'
import { createFileRoute, Outlet, useRouterState, useRouteContext } from '@tanstack/react-router'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { SettingsNav } from '@/components/admin/settings/settings-nav'
import {
  buildSettingsModules,
  settingsModuleForPath,
} from '@/components/admin/settings/settings-modules'
import { TabStrip } from '@/components/admin/tab-strip'
import { PageHeader } from '@/components/shared/page-header'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { FeatureFlags } from '@/lib/shared/types'

export const Route = createFileRoute('/admin/settings')({
  loader: async ({ context }) => {
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    await ensureBillingCatalogue(context.queryClient, context.billingEnabled)
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const modules = useMemo(() => buildSettingsModules(flags), [flags])
  const currentModule = settingsModuleForPath(pathname, modules)
  const moduleTabs =
    currentModule && currentModule.pages.length > 1
      ? currentModule.pages.map((page) => ({ label: page.label, to: page.to, icon: page.icon }))
      : null

  return (
    <div className="flex h-full bg-background">
      <aside
        data-side-pane=""
        className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-border/50 bg-card/30 overflow-hidden"
      >
        <div className="shrink-0 px-4 py-3.5">
          <PageHeader icon={Cog6ToothIcon} title="Settings" />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 pb-5">
            <SettingsNav />
          </div>
        </ScrollArea>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {moduleTabs ? (
          <div className="shrink-0" data-settings-module-tabs="">
            <TabStrip tabs={moduleTabs} />
          </div>
        ) : null}
        <ScrollArea className="min-h-0 flex-1">
          <div data-settings-page="" className="p-6">
            <Outlet />
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
