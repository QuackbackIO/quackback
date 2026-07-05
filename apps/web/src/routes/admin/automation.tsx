'use client'

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { AutomationNav } from '@/components/admin/automation/automation-nav'
import { PageHeader } from '@/components/shared/page-header'
import { ScrollArea } from '@/components/ui/scroll-area'

export const Route = createFileRoute('/admin/automation')({
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    return {}
  },
  component: AutomationLayout,
})

function AutomationLayout() {
  return (
    <div className="flex h-full bg-background">
      <aside className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-border/50 bg-card/30 overflow-hidden">
        <div className="shrink-0 px-4 py-3.5">
          <PageHeader icon={SparklesIcon} title="AI & Automation" />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 pb-5">
            <AutomationNav />
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
