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

type LabsFlag = 'copilotHome' | 'portalDesignV2'

/** One Labs switch. Home and the portal read the flag from the root route context. */
function LabsSwitch({
  flag,
  label,
  description,
}: {
  flag: LabsFlag
  label: string
  description: string
}) {
  const router = useRouter()
  const flags = useFeatureFlags()
  const [on, setOn] = useState(flags?.[flag] === true)
  const toggle = useMutation({
    meta: AUTOSAVE,
    mutationFn: (next: boolean) => updateFeatureFlagsFn({ data: { [flag]: next } }),
    onMutate: (next) => setOn(next),
    onSuccess: () => void router.invalidate(),
    onError: (_error, next) => setOn(!next),
  })
  const id = `labs-${flag}`
  return (
    <SettingRow
      label={label}
      htmlFor={id}
      description={description}
      control={
        <Switch
          id={id}
          checked={on}
          disabled={toggle.isPending}
          onCheckedChange={(next) => toggle.mutate(next)}
        />
      }
    />
  )
}

function LabsSettingsPage() {
  const intl = useIntl()
  return (
    <SettingsPage page="/admin/settings/labs">
      <SettingsCard>
        <SettingRows>
          <LabsSwitch
            flag="copilotHome"
            label={intl.formatMessage({
              id: 'settings.labs.copilotHome.label',
              defaultMessage: 'Copilot on Home',
            })}
            description={intl.formatMessage({
              id: 'settings.labs.copilotHome.description',
              defaultMessage: 'Ask questions and propose changes from Home.',
            })}
          />
          <LabsSwitch
            flag="portalDesignV2"
            label={intl.formatMessage({
              id: 'settings.labs.portalDesignV2.label',
              defaultMessage: 'New portal design',
            })}
            description={intl.formatMessage({
              id: 'settings.labs.portalDesignV2.description',
              defaultMessage: 'Brand the portal from Appearance, with drafts and versions.',
            })}
          />
        </SettingRows>
      </SettingsCard>
    </SettingsPage>
  )
}
