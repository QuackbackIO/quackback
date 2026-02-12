import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SignalIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { TelemetryToggle } from '@/components/admin/settings/telemetry/telemetry-toggle'
import { TelemetryInfo } from '@/components/admin/settings/telemetry/telemetry-info'
import { settingsQueries } from '@/lib/client/queries/settings'

export const Route = createFileRoute('/admin/settings/telemetry')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.telemetryConfig())
  },
  component: TelemetrySettingsPage,
})

function TelemetrySettingsPage() {
  const telemetryConfigQuery = useSuspenseQuery(settingsQueries.telemetryConfig())

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={SignalIcon}
        title="Telemetry"
        description="Anonymous usage statistics to help improve Quackback"
      />

      <SettingsCard
        title="Anonymous Telemetry"
        description="Enable or disable anonymous usage reporting"
      >
        <TelemetryToggle initialEnabled={telemetryConfigQuery.data.enabled} />
      </SettingsCard>

      <SettingsCard title="What We Collect" description="Transparency about the data collected">
        <TelemetryInfo />
      </SettingsCard>
    </div>
  )
}
