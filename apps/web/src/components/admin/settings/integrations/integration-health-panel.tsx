/** Current-installation sync history and independent connection health. */
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { ArrowUpTrayIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { TimeAgo } from '@/components/ui/time-ago'

export interface IntegrationHealth {
  lastOutboundAt: string | null
  lastInboundAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  attentionCount?: number
}

interface IntegrationHealthPanelProps {
  health: IntegrationHealth | undefined
  onViewHistory?: () => void
}

export function IntegrationHealthPanel({ health, onViewHistory }: IntegrationHealthPanelProps) {
  if (!health) return null
  const { lastOutboundAt, lastInboundAt, lastError, lastErrorAt, attentionCount = 0 } = health

  // Nothing has happened yet and nothing has gone wrong — no panel to show.
  if (!lastOutboundAt && !lastInboundAt && !lastError && !attentionCount) return null

  return (
    <div data-settings-card="" className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Health
      </h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <HealthRow
          icon={<ArrowUpTrayIcon className="h-4 w-4 text-muted-foreground" />}
          label="Last sync sent"
          at={lastOutboundAt}
          emptyLabel="No deliveries yet"
        />
        <HealthRow
          icon={<ArrowDownTrayIcon className="h-4 w-4 text-muted-foreground" />}
          label="Last sync received"
          at={lastInboundAt}
          emptyLabel="None received"
        />
      </dl>

      {attentionCount > 0 && (
        <div className="mt-3 text-sm text-destructive" role="status">
          <p>
            {attentionCount} {attentionCount === 1 ? 'sync needs' : 'syncs need'} attention.
          </p>
          {onViewHistory && (
            <button type="button" onClick={onViewHistory} className="mt-2 text-xs underline">
              View sync history
            </button>
          )}
        </div>
      )}

      {lastError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <span>Connection error</span>
              {lastErrorAt && (
                <span className="font-normal text-destructive/70">
                  <TimeAgo date={lastErrorAt} />
                </span>
              )}
            </div>
            <p className="mt-0.5 break-words text-xs text-destructive/90">{lastError}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function HealthRow({
  icon,
  label,
  at,
  emptyLabel,
}: {
  icon: React.ReactNode
  label: string
  at: string | null
  emptyLabel: string
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div className="min-w-0">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className="text-sm text-foreground">
          {at ? <TimeAgo date={at} /> : <span className="text-muted-foreground">{emptyLabel}</span>}
        </dd>
      </div>
    </div>
  )
}
