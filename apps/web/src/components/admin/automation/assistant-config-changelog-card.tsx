/**
 * AI config changelog: a read-only feed of assistant-config mutations
 * (guidance rule CRUD, tool controls, per-surface instructions, the Basics
 * preset, data connector CRUD) sourced from the append-only audit log via
 * getAssistantConfigChangelogFn. Purely observational, no actions here,
 * just "what changed, who changed it, when".
 */
import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { TimeAgo } from '@/components/ui/time-ago'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { ASSISTANT_CONFIG_EVENT_LABELS } from '@/lib/shared/assistant/config-audit-events'
import type { AuditEventRow } from '@/lib/server/functions/audit-log'

/** Friendly label per assistant-config audit event. Falls back to the raw
 *  event string for anything not in the shared map, so a future event type
 *  never renders blank. */
function eventLabel(eventType: string): string {
  return (ASSISTANT_CONFIG_EVENT_LABELS as Record<string, string>)[eventType] ?? eventType
}

function EntryRow({ entry }: { entry: AuditEventRow }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{eventLabel(entry.eventType)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.actorEmail ?? 'Unknown actor'}
        </p>
      </div>
      <TimeAgo date={entry.occurredAt} className="shrink-0 text-xs text-muted-foreground" />
    </div>
  )
}

export function AssistantConfigChangelogCard() {
  const changelogQuery = useQuery(assistantQueries.configChangelog())
  const entries = changelogQuery.data ?? []

  return (
    <SettingsCard
      title="Recent changes"
      description="A record of who changed the assistant's guidance, tools, and connectors, and when."
    >
      {entries.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No AI config changes recorded yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </SettingsCard>
  )
}
