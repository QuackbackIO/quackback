import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AssistantPendingActionId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { assistantPendingActionQueries } from '@/lib/client/queries/assistant-pending-actions'
import type { CopilotProposedAction } from '@/lib/shared/assistant/copilot-contract'
import {
  approveAssistantActionFn,
  rejectAssistantActionFn,
} from '@/lib/server/functions/assistant-actions'

/**
 * A connector call Copilot wants to make from Home. Nothing reaches the
 * connector until the teammate clicks Allow; Skip sends nothing.
 */
export function ConnectorCallCard({
  action,
  onAllowed,
}: {
  action: CopilotProposedAction & { connector: { name: string; initials: string } }
  onAllowed: (connectorName: string) => void
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const options = assistantPendingActionQueries.detail(action.id as AssistantPendingActionId)
  const detail = useQuery(options)
  const [failed, setFailed] = useState(false)
  const decide = useMutation({
    mutationFn: (decision: 'allow' | 'skip') =>
      (decision === 'allow' ? approveAssistantActionFn : rejectAssistantActionFn)({
        data: { pendingActionId: action.id },
      }),
    onSuccess: (row, decision) => {
      setFailed(false)
      queryClient.setQueryData(options.queryKey, row as never)
      if (decision === 'allow' && row.status === 'executed') onAllowed(action.connector.name)
    },
    onError: () => {
      setFailed(true)
      void queryClient.invalidateQueries({ queryKey: options.queryKey })
    },
  })
  const status = detail.data?.status ?? 'proposed'
  const name = action.connector.name
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 shadow-raise">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold"
      >
        {action.connector.initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{action.summary || action.label}</p>
        <p className="text-xs text-muted-foreground">
          {status === 'rejected'
            ? intl.formatMessage(
                {
                  id: 'ask.connector.skipped',
                  defaultMessage: 'Skipped {name}. Nothing was sent.',
                },
                { name }
              )
            : status === 'executed'
              ? intl.formatMessage(
                  { id: 'ask.connector.allowed', defaultMessage: 'Allowed {name}' },
                  { name }
                )
              : status === 'proposed'
                ? intl.formatMessage(
                    { id: 'ask.connector.sends', defaultMessage: 'Sends this request to {name}' },
                    { name }
                  )
                : intl.formatMessage({
                    id: 'ask.connector.unavailable',
                    defaultMessage: 'This request is no longer available.',
                  })}
        </p>
      </div>
      {status === 'proposed' && (
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={decide.isPending}
            className="focus-visible:ring-muted-foreground"
            onClick={() => decide.mutate('skip')}
          >
            {intl.formatMessage({ id: 'ask.connector.skip', defaultMessage: 'Skip' })}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={decide.isPending}
            className="focus-visible:ring-muted-foreground"
            onClick={() => decide.mutate('allow')}
          >
            {intl.formatMessage({ id: 'ask.connector.allow', defaultMessage: 'Allow' })}
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert" className="w-full text-sm text-destructive">
          {intl.formatMessage({
            id: 'ask.connector.failed',
            defaultMessage: 'That did not work. Try again.',
          })}
        </p>
      )}
    </div>
  )
}
