'use client'

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { SettingsNav } from '@/components/admin/settings/settings-nav'
import { ScrollArea } from '@/components/ui/scroll-area'

export const Route = createFileRoute('/admin/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <div className="flex h-full bg-background">
      <aside className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-border/50 bg-card/30 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-5">
            <SettingsNav />
          </div>
        </ScrollArea>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6 max-w-5xl">
            <Outlet />
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
