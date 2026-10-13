import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { useIntl } from 'react-intl'
import {
  AgentPauseControl,
  useAgentStatusLine,
} from '@/components/admin/automation/assistant-deployment-card'
import { WhoRepliesFirstCard } from '@/components/admin/automation/who-replies-first-card'
import { ConversationRoutingCard } from '@/components/admin/settings/conversation-routing-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { settingsQueries } from '@/lib/client/queries/settings'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types'

const AnsweringModeCard = lazy(() =>
  import('./agents/answering-mode-card').then((module) => ({ default: module.AnsweringModeCard }))
)

/**
 * Who replies to a new conversation: whether Quackback AI answers customers,
 * the order replies are tried in, and whether teammates are assigned
 * automatically. Each part shows to the people who may change it.
 */
export function WhoAnswersPage() {
  const intl = useIntl()
  const canAi = usePermission(PERMISSIONS.AI_CUSTOMER_MANAGE)
  const canRoute = usePermission(PERMISSIONS.SETTINGS_MANAGE)
  const settings = useWorkspaceSettings()
  const widget = useQuery(settingsQueries.widgetConfig())
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const deployment =
    widget.data?.messenger?.assistant ?? settings?.publicWidgetConfig?.messenger?.assistant
  const live = { enabled: deployment?.enabled ?? true, respond: deployment?.respond ?? true }
  const statusLine = useAgentStatusLine(
    live,
    Boolean(flags?.supportInbox),
    Boolean(flags?.supportTickets)
  )

  return (
    <SettingsPage page="/admin/settings/who-answers">
      {canRoute && flags?.ownAgent && (
        <Suspense fallback={null}>
          <AnsweringModeCard />
        </Suspense>
      )}
      {canAi && (
        <SettingsCard>
          <SettingRows>
            <SettingRow
              label={intl.formatMessage({
                id: 'ai.whoAnswers.customers',
                defaultMessage: 'Quackback AI for customers',
              })}
              description={statusLine}
              control={
                <AgentPauseControl
                  deployment={live}
                  available={Boolean(flags?.supportInbox)}
                  ticketsOn={Boolean(flags?.supportTickets)}
                  onChange={() => {}}
                />
              }
            />
          </SettingRows>
        </SettingsCard>
      )}
      <WhoRepliesFirstCard />
      {canRoute && <ConversationRoutingCard />}
    </SettingsPage>
  )
}
