/**
 * Integration health panel (IF WO-6). Surfaces the per-integration telemetry
 * captured by IF WO-14: last successful outbound delivery, last inbound
 * webhook, and the last recorded error. Rendered on a connected integration's
 * settings page. Renders nothing until there's at least one signal to show.
 */
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { ArrowUpTrayIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { TimeAgo } from '@/components/ui/time-ago'

export interface IntegrationHealth {
  lastOutboundAt: string | null
  lastInboundAt: string | null
  lastError: string | null
  lastErrorAt: string | null
}

interface IntegrationHealthPanelProps {
  health: IntegrationHealth | undefined
}

export function IntegrationHealthPanel({ health }: IntegrationHealthPanelProps) {
  if (!health) return null
  const { lastOutboundAt, lastInboundAt, lastError, lastErrorAt } = health

  // Nothing has happened yet and nothing has gone wrong — no panel to show.
  if (!lastOutboundAt && !lastInboundAt && !lastError) return null

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Health
      </h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <HealthRow
          icon={<ArrowUpTrayIcon className="h-4 w-4 text-muted-foreground" />}
          label="Last delivery"
          at={lastOutboundAt}
          emptyLabel="No deliveries yet"
        />
        <HealthRow
          icon={<ArrowDownTrayIcon className="h-4 w-4 text-muted-foreground" />}
          label="Last inbound"
          at={lastInboundAt}
          emptyLabel="None received"
        />
      </dl>

      {lastError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <span>Last error</span>
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
