/** Current-installation sync history and independent connection health. */
import type { ReactNode } from 'react'
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
  /** Connect or Disconnect, sitting on the Health title row. */
  actions?: ReactNode
  /** Header column. Always shows the two times, including before anything has synced. */
  embedded?: boolean
}

const emptyHealth: IntegrationHealth = {
  lastOutboundAt: null,
  lastInboundAt: null,
  lastError: null,
  lastErrorAt: null,
  attentionCount: 0,
}

export function IntegrationHealthPanel({
  health,
  onViewHistory,
  actions,
  embedded = false,
}: IntegrationHealthPanelProps) {
  const resolved = health ?? emptyHealth
  const { lastOutboundAt, lastInboundAt, lastError, lastErrorAt, attentionCount = 0 } = resolved

  // A standalone card with nothing to say stays hidden. The header column does not.
  if (!embedded && !lastOutboundAt && !lastInboundAt && !lastError && !attentionCount && !actions)
    return null

  return (
    <div
      data-settings-card={embedded ? undefined : ''}
      className={embedded ? undefined : 'rounded-xl border border-border/50 bg-card p-4 shadow-sm'}
    >
      <div className="flex items-start justify-between gap-3">
        <h3
          className={`text-[11px] font-medium uppercase tracking-wide text-muted-foreground ${actions ? 'pt-1.5' : ''}`}
        >
          Health
        </h3>
        {actions}
      </div>
      <dl className={`mt-3 grid gap-3 ${embedded ? 'grid-cols-2' : 'sm:grid-cols-2'}`}>
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
        <p className="mt-3 text-sm text-destructive" role="status">
          {attentionCount} {attentionCount === 1 ? 'sync needs' : 'syncs need'} attention.
        </p>
      )}
      {onViewHistory && (
        <button type="button" onClick={onViewHistory} className="mt-2 text-xs underline">
          View sync history
        </button>
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
