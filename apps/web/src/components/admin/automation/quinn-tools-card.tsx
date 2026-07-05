/**
 * Tools & connectors metrics (Quinn performance area): per-tool action
 * counts and success rate over the last 30 days, plus a health glance at the
 * admin-defined data connectors Quinn calls out to. Read-only reporting;
 * gated server-side on analytics.view like the rest of the Quinn performance
 * surface. `healthStatus` is a coarse three-tier summary computed server-side
 * (domains/analytics/quinn-tools.ts) — the connector management table
 * (connectors/connector-health.ts) has the finer Issues/Failing breakdown for
 * an admin actually fixing a connector.
 */
import { useQuery } from '@tanstack/react-query'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MetricTile, useLast30DaysRange, pct, asRate } from './metric-tile'
import {
  quinnToolMetricsQuery,
  connectorHealthQuery,
} from '@/lib/client/queries/assistant-tools-analytics'
import type { ConnectorHealthStatus } from '@/lib/server/domains/analytics/quinn-tools'

const HEALTH_BADGE: Record<ConnectorHealthStatus, { label: string; className: string }> = {
  healthy: { label: 'Healthy', className: 'border-green-500/30 text-green-600' },
  degraded: { label: 'Degraded', className: 'border-amber-500/30 text-amber-600' },
  unhealthy: { label: 'Unhealthy', className: '' },
}

function ConnectorBadge({ health }: { health: ConnectorHealthStatus }) {
  const { label, className } = HEALTH_BADGE[health]
  return health === 'unhealthy' ? (
    <Badge variant="destructive">{label}</Badge>
  ) : (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  )
}

export function QuinnToolsCard() {
  const range = useLast30DaysRange()
  const { data: tools } = useQuery(quinnToolMetricsQuery(range.from, range.to))
  const { data: connectors } = useQuery(connectorHealthQuery())

  const toolList = tools ?? []
  const connectorList = connectors ?? []
  const totalActions = toolList.reduce((sum, t) => sum + t.succeeded, 0)

  return (
    <SettingsCard
      title="Tools and connectors"
      description="Actions Quinn has taken and the health of its data connectors, over the last 30 days."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Actions taken" value={String(totalActions)} />
      </div>

      <div className="mt-4">
        {toolList.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No tool activity for this period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Success rate</TableHead>
                <TableHead className="text-right">Denied / duplicate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toolList.map((tool) => {
                const deniedOrDuplicate = tool.denied + tool.skippedDuplicate
                const total = tool.succeeded + tool.failed + tool.denied + tool.skippedDuplicate
                return (
                  <TableRow key={tool.toolName}>
                    <TableCell className="font-mono text-xs">{tool.toolName}</TableCell>
                    <TableCell className="text-right tabular-nums">{total}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(asRate(tool.successRate))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {deniedOrDuplicate > 0 ? deniedOrDuplicate : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-medium">Connectors</h3>
        {connectorList.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No connectors configured. Set one up in AI &amp; Automation to let Quinn call your APIs.
          </p>
        ) : (
          <ul className="space-y-2">
            {connectorList.map((connector) => (
              <li key={connector.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{connector.name}</span>
                {connector.lastError ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <ConnectorBadge health={connector.healthStatus} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{connector.lastError}</TooltipContent>
                  </Tooltip>
                ) : (
                  <ConnectorBadge health={connector.healthStatus} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsCard>
  )
}
