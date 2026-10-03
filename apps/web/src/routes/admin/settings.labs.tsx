import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { Switch } from '@/components/ui/switch'
import { AUTOSAVE } from '@/lib/client/autosave'
import { useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { updateFeatureFlagsFn } from '@/lib/server/functions/feature-flags'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'

export const Route = createFileRoute('/admin/settings/labs')({
  loader: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
  },
  component: LabsSettingsPage,
})

function LabsSettingsPage() {
  const intl = useIntl()
  const router = useRouter()
  const flags = useFeatureFlags()
  const [copilotHome, setCopilotHome] = useState(flags?.copilotHome === true)
  const toggle = useMutation({
    meta: AUTOSAVE,
    mutationFn: (next: boolean) => updateFeatureFlagsFn({ data: { copilotHome: next } }),
    onMutate: (next) => setCopilotHome(next),
    // Home reads the flag from the root route context.
    onSuccess: () => void router.invalidate(),
    onError: (_error, next) => setCopilotHome(!next),
  })
  return (
    <SettingsPage page="/admin/settings/labs">
      <SettingsCard>
        <SettingRows>
          <SettingRow
            label={intl.formatMessage({
              id: 'settings.labs.copilotHome.label',
              defaultMessage: 'Copilot on Home',
            })}
            htmlFor="labs-copilot-home"
            description={intl.formatMessage({
              id: 'settings.labs.copilotHome.description',
              defaultMessage: 'Ask questions and propose changes from Home.',
            })}
            control={
              <Switch
                id="labs-copilot-home"
                checked={copilotHome}
                disabled={toggle.isPending}
                onCheckedChange={(next) => toggle.mutate(next)}
              />
            }
          />
        </SettingRows>
      </SettingsCard>
    </SettingsPage>
  )
}
