import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { SecuritySettings } from '@/components/admin/settings/security/security-settings'
import { SettingsCard } from '@/components/admin/settings/settings-card'

export const Route = createFileRoute('/admin/settings/security')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.securityConfig())

    return {}
  },
  component: SecurityPage,
})

function SecurityPage() {
  const securityConfigQuery = useSuspenseQuery(settingsQueries.securityConfig())

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <ShieldCheckIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Security</h1>
          <p className="text-sm text-muted-foreground">Configure sign-in methods for your team</p>
        </div>
      </div>

      <SettingsCard
        title="Authentication"
        description="Control how team members sign in to the admin dashboard"
      >
        <SecuritySettings securityConfig={securityConfigQuery.data} />
      </SettingsCard>
    </div>
  )
}
