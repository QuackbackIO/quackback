import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { SignalIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { StatusGeneralCard } from '@/components/admin/settings/status/status-general-card'
import { StatusVisibilityCard } from '@/components/admin/settings/status/status-visibility-card'
import { StatusNotificationsCard } from '@/components/admin/settings/status/status-notifications-card'
import { StatusDangerCard } from '@/components/admin/settings/status/status-danger-card'
import { updateStatusSettingsFn } from '@/lib/server/functions/status'
import { statusSettingsQueries } from '@/lib/client/queries/status'
import { DEFAULT_STATUS_SETTINGS, type StatusSettings } from '@/lib/shared/status-settings'

export const Route = createFileRoute('/admin/settings/status')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    await context.queryClient.ensureQueryData(statusSettingsQueries.get())
    return {}
  },
  component: StatusSettingsPage,
})

function StatusSettingsPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(statusSettingsQueries.get())
  const [settings, setSettings] = useState<StatusSettings>(data ?? DEFAULT_STATUS_SETTINGS)

  const mutation = useMutation({
    mutationFn: (patch: Partial<StatusSettings>) => updateStatusSettingsFn({ data: patch }),
    onSuccess: (saved) => {
      setSettings(saved)
      queryClient.setQueryData(statusSettingsQueries.get().queryKey, saved)
    },
  })

  function onChange(patch: Partial<StatusSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }))
    mutation.mutate(patch)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={SignalIcon}
        title="Status"
        description="Public status page for your services — incidents, maintenance, and uptime history."
      />

      <StatusGeneralCard settings={settings} onChange={onChange} disabled={mutation.isPending} />
      <StatusVisibilityCard settings={settings} onChange={onChange} disabled={mutation.isPending} />
      <StatusNotificationsCard
        settings={settings}
        onChange={onChange}
        disabled={mutation.isPending}
      />
      <StatusDangerCard />
    </div>
  )
}
