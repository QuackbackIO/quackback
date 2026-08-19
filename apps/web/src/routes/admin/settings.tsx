'use client'

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { SettingsNav } from '@/components/admin/settings/settings-nav'
import { PageHeader } from '@/components/shared/page-header'
import { ScrollArea } from '@/components/ui/scroll-area'

export const Route = createFileRoute('/admin/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <div className="flex h-full bg-background">
      <aside className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-border/50 bg-card/30 overflow-hidden">
        <div className="shrink-0 px-4 py-3.5">
          <PageHeader icon={Cog6ToothIcon} title="Settings" />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 pb-5">
            <SettingsNav />
          </div>
        </ScrollArea>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6">
            <Outlet />
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
