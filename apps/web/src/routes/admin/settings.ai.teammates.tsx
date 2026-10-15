import { createFileRoute } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import {
  CopilotPauseControl,
  useCopilotStatusLine,
} from '@/components/admin/automation/copilot-deployment-card'
import { AssistantPageShell } from '@/components/admin/automation/assistant-page-shell'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/ai/teammates')({
  head: adminPageHead('Quackback AI settings: Teammates'),
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.AI_TEAMMATE_MANAGE)
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(assistantQueries.settings())
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: TeammatesPage,
})

function TeammatesPage() {
  return (
    <AssistantPageShell page="/admin/settings/ai/teammates">
      <TeammatesCard />
    </AssistantPageShell>
  )
}

function TeammatesCard() {
  const intl = useIntl()
  const statusLine = useCopilotStatusLine()
  return (
    <SettingsCard>
      <SettingRows>
        <SettingRow
          label={intl.formatMessage({
            id: 'ai.teammates.label',
            defaultMessage: 'Quackback AI for teammates',
          })}
          description={statusLine}
          control={<CopilotPauseControl />}
        />
      </SettingRows>
    </SettingsCard>
  )
}
