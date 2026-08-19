'use client'

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { AutomationNav } from '@/components/admin/automation/automation-nav'
import { PageHeader } from '@/components/shared/page-header'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

export const Route = createFileRoute('/admin/automation')({
  beforeLoad: ({ context }) => {
    const permissions = (context as { permissions?: PermissionKey[] }).permissions ?? []
    const canOpen = [PERMISSIONS.ASSISTANT_MANAGE, PERMISSIONS.WORKFLOW_MANAGE].some((permission) =>
      permissions.includes(permission)
    )
    if (!canOpen) throw new Error('Access denied: requires an AI & Automation permission')
  },
  component: AutomationLayout,
})

function AutomationLayout() {
  const intl = useIntl()
  return (
    <div className="flex h-full bg-background">
      <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-e border-border/50 bg-card/30 lg:flex xl:w-72">
        <div className="shrink-0 px-4 py-3.5">
          <PageHeader
            icon={SparklesIcon}
            title={intl.formatMessage({
              id: 'automation.nav.label',
              defaultMessage: 'AI & Automation',
            })}
          />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 pb-5">
            <AutomationNav />
          </div>
        </ScrollArea>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 sm:p-6">
            <Outlet />
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
