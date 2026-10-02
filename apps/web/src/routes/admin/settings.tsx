'use client'

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { SettingsNav, SettingsNavProvider } from '@/components/admin/settings/settings-nav'
import { PageHeader } from '@/components/shared/page-header'
import { ScrollArea } from '@/components/ui/scroll-area'

export const Route = createFileRoute('/admin/settings')({
  loader: async ({ context }) => {
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    await ensureBillingCatalogue(context.queryClient, context.billingEnabled)
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <SettingsNavProvider>
      <div className="flex h-full bg-background">
        <aside
          data-side-pane=""
          className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-e border-chrome-hairline bg-background overflow-hidden"
        >
          <div className="shrink-0 px-5 py-3.5">
            <PageHeader as="h2" title="Settings" />
          </div>
          <ScrollArea
            className="min-h-0 flex-1"
            scrollBarClassName="w-1.5 opacity-0 transition-opacity data-[scrolling]:opacity-100"
          >
            <div className="px-2.5 pb-5">
              <SettingsNav />
            </div>
          </ScrollArea>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <ScrollArea className="min-h-0 flex-1">
            <div data-settings-page="" className="px-4 pb-6 pt-3.5 sm:px-6">
              <Outlet />
            </div>
          </ScrollArea>
        </main>
      </div>
    </SettingsNavProvider>
  )
}
