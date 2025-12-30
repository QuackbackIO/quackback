import { createFileRoute, Outlet } from '@tanstack/react-router'
import { isSelfHosted } from '@/lib/features'
import { SettingsNav } from '@/app/admin/settings/settings-nav'

export const Route = createFileRoute('/admin/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  const isCloud = !isSelfHosted()

  return (
    <div className="flex gap-8 px-6 py-8">
      <SettingsNav isCloud={isCloud} />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
