import { useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { MegaphoneIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { VisibilityCard } from '@/components/admin/settings/changelog/visibility-card'
import { LabelsCard } from '@/components/admin/settings/changelog/labels-card'
import { EmailCard } from '@/components/admin/settings/changelog/email-card'
import { updateChangelogSettingsFn } from '@/lib/server/functions/settings'
import { changelogCategoryQueries, changelogSettingsQueries } from '@/lib/client/queries/changelog'
import { DEFAULT_CHANGELOG_SETTINGS, type ChangelogSettings } from '@/lib/shared/changelog-settings'
import { isProductEnabled } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/changelog')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'changelog')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.CHANGELOG_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(changelogSettingsQueries.get()),
      context.queryClient.ensureQueryData(changelogCategoryQueries.list()),
    ])
    return {}
  },
  component: ChangelogSettingsPage,
})

function ChangelogSettingsPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(changelogSettingsQueries.get())
  const { data: categories } = useSuspenseQuery(changelogCategoryQueries.list())
  const [settings, setSettings] = useState<ChangelogSettings>(data ?? DEFAULT_CHANGELOG_SETTINGS)

  const mutation = useMutation({
    mutationFn: (patch: Partial<ChangelogSettings>) => updateChangelogSettingsFn({ data: patch }),
    onSuccess: (saved) => {
      setSettings(saved)
      queryClient.setQueryData(changelogSettingsQueries.get().queryKey, saved)
    },
  })

  function onChange(patch: Partial<ChangelogSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }))
    mutation.mutate(patch)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={MegaphoneIcon}
        title="Changelog"
        description="Control who sees your changelog, organize entries with labels, and manage subscriber emails."
      />

      <VisibilityCard settings={settings} onChange={onChange} disabled={mutation.isPending} />
      <LabelsCard initialCategories={categories} />
      <EmailCard settings={settings} onChange={onChange} disabled={mutation.isPending} />
    </div>
  )
}
