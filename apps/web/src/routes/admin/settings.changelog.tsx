import { useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { AUTOSAVE } from '@/lib/client/autosave'
import { VisibilityCard } from '@/components/admin/settings/changelog/visibility-card'
import { LabelsCard } from '@/components/admin/settings/changelog/labels-card'
import { EmailCard } from '@/components/admin/settings/changelog/email-card'
import { updateChangelogSettingsFn } from '@/lib/server/functions/settings'
import { changelogCategoryQueries, changelogSettingsQueries } from '@/lib/client/queries/changelog'
import { DEFAULT_CHANGELOG_SETTINGS, type ChangelogSettings } from '@/lib/shared/changelog-settings'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { readBatch } from '@/lib/client/queries/read-batch'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/changelog')({
  head: adminPageHead('Changelog settings'),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'changelog')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.CHANGELOG_MANAGE)
    const ensure = readBatch(context.queryClient)
    await Promise.all([
      ensure(changelogSettingsQueries.get()),
      ensure(changelogCategoryQueries.list()),
      // A segment-gated label shows its segments by name, read under
      // segment.view; without it the names fall back to ids, as before.
      context.permissions?.includes(PERMISSIONS.SEGMENT_VIEW)
        ? warmQuery(ensure, changelogCategoryQueries.segments())
        : undefined,
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
    meta: AUTOSAVE,
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
    <SettingsPage page="/admin/settings/changelog">
      <VisibilityCard settings={settings} onChange={onChange} disabled={mutation.isPending} />
      <LabelsCard initialCategories={categories} />
      <EmailCard settings={settings} onChange={onChange} disabled={mutation.isPending} />
    </SettingsPage>
  )
}
