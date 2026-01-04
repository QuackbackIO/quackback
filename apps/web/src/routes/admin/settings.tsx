'use client'

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { isCloud } from '@/lib/features'
import { useWorkspaceFeatures } from '@/lib/hooks/use-features'
import { SettingsNav } from '@/components/admin/settings/settings-nav'

export const Route = createFileRoute('/admin/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  const { data } = useWorkspaceFeatures()

  return (
    <div className="flex gap-8 px-6 py-8">
      <SettingsNav isCloud={isCloud()} hasEnterprise={data?.hasEnterprise ?? false} />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
