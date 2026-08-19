import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { ASSISTANT_CONFIG_EVENT_LABELS } from '@/lib/shared/assistant/config-audit-events'
import type { AuditEventRow } from '@/lib/server/functions/audit-log'

function EntryRow({ entry }: { entry: AuditEventRow }) {
  const intl = useIntl()
  const fallback =
    (ASSISTANT_CONFIG_EVENT_LABELS as Record<string, string>)[entry.eventType] ?? entry.eventType
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {intl.formatMessage({
            id: `automation.agent.history.event.${entry.eventType}`,
            defaultMessage: fallback,
          })}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.actorEmail ??
            intl.formatMessage({
              id: 'automation.agent.history.unknownActor',
              defaultMessage: 'Unknown teammate',
            })}
        </p>
      </div>
      <TimeAgo date={entry.occurredAt} className="shrink-0 text-xs text-muted-foreground" />
    </div>
  )
}

export function AssistantConfigChangelogCard() {
  const intl = useIntl()
  const changelogQuery = useQuery(assistantQueries.configChangelog())

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.agent.history.title',
        defaultMessage: 'Change history',
      })}
      description={intl.formatMessage({
        id: 'automation.agent.history.description',
        defaultMessage:
          'See who changed Quinn’s settings and when, across both the Agent and Copilot.',
      })}
    >
      {changelogQuery.isPending ? (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.agent.history.loading',
            defaultMessage: 'Loading change history…',
          })}
        </p>
      ) : changelogQuery.isError ? (
        <div className="flex items-center justify-between gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.agent.history.error',
              defaultMessage: 'Change history could not be loaded.',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void changelogQuery.refetch()}>
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      ) : changelogQuery.data.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.agent.history.empty',
            defaultMessage: 'No AI agent setting changes have been recorded yet.',
          })}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {changelogQuery.data.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </SettingsCard>
  )
}
