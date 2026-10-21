'use client'

/**
 * One repository's ticket opt-in: whether each new ticket it matches gets an
 * issue there, and which tickets match, by team and by ticket type. Choosing
 * none of either lets every ticket through. Only tickets opened after it is
 * switched on get an issue; a ticket that comes from one of the connection's
 * own issues never does. Shown on the repository's card.
 */
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ChevronUpDownIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { inboxTeamsQueryOptions } from '@/lib/client/queries/inbox-teams'
import { ticketQueries } from '@/lib/client/queries/inbox'
import { useSetIntegrationDestinationTicketIssues } from '@/lib/client/mutations'
import type { DestinationTicketIssues } from '@/lib/server/integrations/destination-admin'

interface Option {
  id: string
  name: string
}

/** A button listing what is chosen, opening a checklist of every option. */
function MultiFilter({
  options,
  selected,
  allLabel,
  countLabel,
  ariaLabel,
  disabled,
  onChange,
}: {
  options: Option[]
  selected: string[]
  allLabel: string
  countLabel: (count: number) => string
  ariaLabel: string
  disabled?: boolean
  onChange: (selected: string[]) => void
}) {
  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.id === selected[0])?.name ?? countLabel(1))
        : countLabel(selected.length)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={ariaLabel}
          className="h-8 w-44 justify-between text-xs font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronUpDownIcon className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={selected.includes(option.id)}
            onCheckedChange={(checked) =>
              onChange(
                checked === true
                  ? [...selected, option.id]
                  : selected.filter((id) => id !== option.id)
              )
            }
          >
            {option.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function GitHubTicketIssues({
  destinationId,
  repository,
  settings,
  disabled,
}: {
  destinationId: string
  repository: string
  settings: DestinationTicketIssues
  /** A receive-only repository takes no new issues. */
  disabled?: boolean
}) {
  const intl = useIntl()
  const save = useSetIntegrationDestinationTicketIssues()
  const teams = useQuery({ ...inboxTeamsQueryOptions(), enabled: settings.enabled })
  const types = useQuery({ ...ticketQueries.types(), enabled: settings.enabled })
  const typeOptions = (types.data ?? [])
    .filter((t) => !t.archived)
    .map((t) => ({ id: t.id, name: t.icon ? `${t.icon} ${t.name}` : t.name }))
  const busy = disabled || save.isPending
  const update = (patch: Partial<DestinationTicketIssues>) =>
    save.mutate(
      { destinationId, ...settings, ...patch },
      {
        onError: () =>
          toast.error(
            intl.formatMessage({
              id: 'admin.githubRepository.saveFailed',
              defaultMessage: 'Could not save the repository settings',
            })
          ),
      }
    )

  return (
    <div className="flex basis-full flex-wrap items-center gap-2 text-xs">
      <Switch
        checked={settings.enabled}
        disabled={busy}
        onCheckedChange={(enabled) => update({ enabled })}
        aria-label={intl.formatMessage(
          {
            id: 'admin.githubRepository.ticketIssues.toggle',
            defaultMessage: 'Create an issue in {repository} for each new ticket it matches',
          },
          { repository }
        )}
      />
      <span aria-hidden>
        <FormattedMessage
          id="admin.githubRepository.ticketIssues"
          defaultMessage="Create an issue for new tickets"
        />
      </span>
      {settings.enabled && (
        <>
          <MultiFilter
            options={(teams.data ?? []).map((t) => ({ id: t.id, name: t.name }))}
            selected={settings.teamIds}
            disabled={busy}
            onChange={(teamIds) => update({ teamIds })}
            allLabel={intl.formatMessage({
              id: 'admin.githubRepository.ticketIssues.allTeams',
              defaultMessage: 'All teams',
            })}
            countLabel={(count) =>
              intl.formatMessage(
                {
                  id: 'admin.githubRepository.ticketIssues.teamCount',
                  defaultMessage: 'Teams ({count})',
                },
                { count }
              )
            }
            ariaLabel={intl.formatMessage(
              {
                id: 'admin.githubRepository.ticketIssues.teams',
                defaultMessage: 'Teams whose tickets get an issue in {repository}',
              },
              { repository }
            )}
          />
          <MultiFilter
            options={typeOptions}
            selected={settings.ticketTypeIds}
            disabled={busy}
            onChange={(ticketTypeIds) => update({ ticketTypeIds })}
            allLabel={intl.formatMessage({
              id: 'admin.githubRepository.ticketIssues.allTypes',
              defaultMessage: 'All ticket types',
            })}
            countLabel={(count) =>
              intl.formatMessage(
                {
                  id: 'admin.githubRepository.ticketIssues.typeCount',
                  defaultMessage: 'Ticket types ({count})',
                },
                { count }
              )
            }
            ariaLabel={intl.formatMessage(
              {
                id: 'admin.githubRepository.ticketIssues.types',
                defaultMessage: 'Ticket types that get an issue in {repository}',
              },
              { repository }
            )}
          />
          <span className="basis-full text-muted-foreground">
            <FormattedMessage
              id="admin.githubRepository.ticketIssues.help"
              defaultMessage="Applies to tickets opened from now on. With no team or type chosen, every ticket gets an issue."
            />
          </span>
        </>
      )}
    </div>
  )
}
