import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MetricTile, useLast30DaysRange } from './metric-tile'
import { quinnToolMetricsQuery } from '@/lib/client/queries/assistant-tools-analytics'

function ActionLabel({ toolName }: { toolName: string }) {
  const intl = useIntl()
  const defaults: Record<string, string> = {
    search: 'Find an answer',
    // Historical ledger rows predate the tool's rename to `search`.
    search_knowledge: 'Find an answer',
    set_attribute: 'Update customer details',
    end_conversation: 'End a conversation',
    create_ticket: 'Create a ticket',
    capture_feedback: 'Capture feedback',
    share_post: 'Share a feedback post',
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help font-medium">
          {intl.formatMessage({
            id: `automation.performance.action.${toolName}`,
            defaultMessage: defaults[toolName] ?? 'Action',
          })}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {intl.formatMessage(
          {
            id: 'automation.performance.action.technicalName',
            defaultMessage: 'Technical name: {name}',
          },
          { name: toolName }
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export function QuinnToolsCard() {
  const intl = useIntl()
  const range = useLast30DaysRange()
  const toolsQuery = useQuery(quinnToolMetricsQuery(range.from, range.to))
  const toolList = toolsQuery.data ?? []
  const totals = toolList.reduce(
    (sum, tool) => ({
      attempted: sum.attempted + tool.succeeded + tool.failed + tool.denied,
      completed: sum.completed + tool.succeeded,
      failed: sum.failed + tool.failed,
      denied: sum.denied + tool.denied + tool.skippedDuplicate,
    }),
    { attempted: 0, completed: 0, failed: 0, denied: 0 }
  )

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.performance.actions.title',
        defaultMessage: 'Actions',
      })}
      description={intl.formatMessage({
        id: 'automation.performance.actions.description',
        defaultMessage: 'Confirmed action outcomes over the last 30 days.',
      })}
    >
      {toolsQuery.isError ? (
        <div className="flex items-center justify-between gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.performance.actions.error',
              defaultMessage: 'Action performance could not be loaded.',
            })}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void toolsQuery.refetch()
            }}
          >
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.actions.attempted',
                defaultMessage: 'Attempted',
              })}
              value={String(totals.attempted)}
            />
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.actions.completed',
                defaultMessage: 'Completed',
              })}
              value={String(totals.completed)}
            />
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.actions.failed',
                defaultMessage: 'Failed',
              })}
              value={String(totals.failed)}
            />
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.actions.notRun',
                defaultMessage: 'Not run',
              })}
              value={String(totals.denied)}
            />
          </div>

          <div className="mt-4">
            {toolList.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.performance.actions.empty',
                  defaultMessage: 'No action activity for this period.',
                })}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {intl.formatMessage({
                        id: 'automation.performance.actions.action',
                        defaultMessage: 'Action',
                      })}
                    </TableHead>
                    <TableHead className="text-end">
                      {intl.formatMessage({
                        id: 'automation.performance.actions.attempted',
                        defaultMessage: 'Attempted',
                      })}
                    </TableHead>
                    <TableHead className="text-end">
                      {intl.formatMessage({
                        id: 'automation.performance.actions.completed',
                        defaultMessage: 'Completed',
                      })}
                    </TableHead>
                    <TableHead className="text-end">
                      {intl.formatMessage({
                        id: 'automation.performance.actions.failed',
                        defaultMessage: 'Failed',
                      })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {toolList.map((tool) => (
                    <TableRow key={tool.toolName}>
                      <TableCell>
                        <ActionLabel toolName={tool.toolName} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {tool.succeeded + tool.failed + tool.denied}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{tool.succeeded}</TableCell>
                      <TableCell className="text-end tabular-nums">{tool.failed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}
    </SettingsCard>
  )
}
