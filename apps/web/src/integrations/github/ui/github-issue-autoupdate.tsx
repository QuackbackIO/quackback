'use client'

/**
 * One repository's automatic issue updates (`applyAutomatically`, off by
 * default): whether a linked issue follows its ticket's status, priority,
 * assignee and title without a review, and what each ticket status makes of
 * the issue (open, closed as completed or as not planned, or left alone, and
 * an optional label). A status without a choice of its own shows, and gets,
 * the default its category gives. Shown on the repository's card; a
 * receive-only repository sends nothing, so the switch is off-limits there.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ticketQueries } from '@/lib/client/queries/inbox'
import { useSetIntegrationDestinationConfig } from '@/lib/client/mutations'
import {
  ISSUE_LABEL_MAX,
  PRIORITY_LABEL_PREFIX,
  issuePushStateFor,
  type IssuePushState,
  type IssuePushStateMappings,
} from '@/lib/shared/issue-push'
import type { IntegrationDestinationSummary } from '@/lib/server/functions/integration-destinations'

type StateChoice = 'open' | 'closed:completed' | 'closed:not_planned' | 'ignore'

function choiceOf(push: IssuePushState | null): StateChoice {
  if (!push) return 'ignore'
  if (push.state === 'open') return 'open'
  return push.stateReason === 'not_planned' ? 'closed:not_planned' : 'closed:completed'
}

function pushOf(choice: StateChoice, label: string | undefined): IssuePushState | null {
  if (choice === 'ignore') return null
  const base: IssuePushState =
    choice === 'open'
      ? { state: 'open' }
      : {
          state: 'closed',
          stateReason: choice === 'closed:not_planned' ? 'not_planned' : 'completed',
        }
  return label ? { ...base, label } : base
}

export function GitHubIssueAutoUpdate({
  destination,
}: {
  destination: Pick<
    IntegrationDestinationSummary,
    'id' | 'externalId' | 'direction' | 'applyAutomatically' | 'pushStatusMappings'
  >
}) {
  const intl = useIntl()
  const setConfig = useSetIntegrationDestinationConfig()
  const [open, setOpen] = useState(false)
  const statuses = useQuery({ ...ticketQueries.statuses(), enabled: open })
  const mappings: IssuePushStateMappings = destination.pushStatusMappings
  const disabled = setConfig.isPending || destination.direction === 'inbound'
  const repository = destination.externalId
  const saveFailed = () =>
    toast.error(
      intl.formatMessage({
        id: 'admin.githubRepository.saveFailed',
        defaultMessage: 'Could not save the repository settings',
      })
    )
  const save = (config: Record<string, unknown>) =>
    setConfig.mutate({ destinationId: destination.id, config }, { onError: saveFailed })
  const saveStatus = (statusId: string, push: IssuePushState | null) =>
    save({ pushStatusMappings: { ...mappings, [statusId]: push } })

  const stateLabels: Record<StateChoice, string> = {
    open: intl.formatMessage({
      id: 'admin.githubRepository.autoUpdate.open',
      defaultMessage: 'Open',
    }),
    'closed:completed': intl.formatMessage({
      id: 'admin.githubRepository.autoUpdate.closedCompleted',
      defaultMessage: 'Closed as completed',
    }),
    'closed:not_planned': intl.formatMessage({
      id: 'admin.githubRepository.autoUpdate.closedNotPlanned',
      defaultMessage: 'Closed as not planned',
    }),
    ignore: intl.formatMessage({
      id: 'admin.githubRepository.autoUpdate.ignore',
      defaultMessage: 'Leave the issue alone',
    }),
  }

  return (
    <div className="flex basis-full flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Switch
          checked={destination.applyAutomatically}
          disabled={disabled}
          onCheckedChange={(applyAutomatically) => save({ applyAutomatically })}
          aria-label={intl.formatMessage(
            {
              id: 'admin.githubRepository.autoUpdate.toggle',
              defaultMessage: 'Update GitHub issues in {repository} automatically',
            },
            { repository }
          )}
        />
        <span aria-hidden>
          <FormattedMessage
            id="admin.githubRepository.autoUpdate"
            defaultMessage="Update GitHub issues automatically"
          />
        </span>
        {destination.applyAutomatically && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
            <FormattedMessage
              id="admin.githubRepository.autoUpdate.mapping"
              defaultMessage="Issue for each ticket status"
            />
          </Button>
        )}
      </div>
      <span className="text-muted-foreground">
        <FormattedMessage
          id="admin.githubRepository.autoUpdate.help"
          defaultMessage="A linked issue follows its ticket's status, priority label, assignee and title. If someone changed the issue on GitHub since Quackback last saw it, nothing is written and the change waits for review in Sync history. Off: status changes are review proposals."
        />
      </span>
      {destination.applyAutomatically && open && (
        <div className="space-y-2 rounded-lg border border-border/50 p-2">
          {(statuses.data ?? []).map((status) => {
            const push = issuePushStateFor(mappings, status)
            const choice = choiceOf(push)
            return (
              <div key={status.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{status.name}</span>
                <Select
                  value={choice}
                  disabled={disabled}
                  onValueChange={(value) =>
                    saveStatus(status.id, pushOf(value as StateChoice, push?.label))
                  }
                >
                  <SelectTrigger
                    className="h-8 w-48 text-xs"
                    aria-label={intl.formatMessage(
                      {
                        id: 'admin.githubRepository.autoUpdate.state',
                        defaultMessage: 'Issue state for tickets in {status}',
                      },
                      { status: status.name }
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(stateLabels) as StateChoice[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {stateLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  // Remount when the saved label changes, so the field shows it.
                  key={`${status.id}:${push?.label ?? ''}`}
                  defaultValue={push?.label ?? ''}
                  maxLength={ISSUE_LABEL_MAX}
                  disabled={disabled || choice === 'ignore'}
                  placeholder={intl.formatMessage({
                    id: 'admin.githubRepository.autoUpdate.noLabel',
                    defaultMessage: 'No label',
                  })}
                  aria-label={intl.formatMessage(
                    {
                      id: 'admin.githubRepository.autoUpdate.label',
                      defaultMessage: 'Issue label for tickets in {status}',
                    },
                    { status: status.name }
                  )}
                  className="h-8 w-40 text-xs"
                  onBlur={(event) => {
                    const label = event.currentTarget.value.trim()
                    if (label === (push?.label ?? '')) return
                    if (label.toLowerCase().startsWith(PRIORITY_LABEL_PREFIX)) {
                      event.currentTarget.value = push?.label ?? ''
                      return saveFailed()
                    }
                    saveStatus(status.id, pushOf(choice, label || undefined))
                  }}
                />
              </div>
            )
          })}
          <p className="text-muted-foreground">
            <FormattedMessage
              id="admin.githubRepository.autoUpdate.labelsHelp"
              defaultMessage="Quackback only removes the status labels set here and its priority labels; other labels on the issue are never touched."
            />
          </p>
        </div>
      )}
    </div>
  )
}
