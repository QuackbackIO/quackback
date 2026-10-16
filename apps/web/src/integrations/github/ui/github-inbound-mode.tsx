'use client'

/**
 * What one repository does with its issues: nothing, an inbox conversation
 * for each, or a conversation paired with a ticket. With tickets, two more
 * choices: the team the tickets go to and their ticket type (customer types
 * only; no choice means the workspace's default customer type). Shown on the
 * repository's card in the integration and on the GitHub channel page.
 */
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { inboxTeamsQueryOptions } from '@/lib/client/queries/inbox-teams'
import { ticketQueries } from '@/lib/client/queries/inbox'
import type {
  GitHubInboundMode,
  GitHubTicketScope,
} from '@/lib/server/domains/channel-accounts/github-connection'

/** The select value standing for "no team" / "the default type"; Radix forbids an empty one. */
const NONE = '__none__'

export interface GitHubInboundSetting {
  inboundMode: GitHubInboundMode
  ticketScope?: GitHubTicketScope
}

export function GitHubInboundModeControl({
  repository,
  inboundMode,
  ticketScope,
  disabled,
  onChange,
}: {
  repository: string
  inboundMode: GitHubInboundMode
  ticketScope: GitHubTicketScope
  disabled?: boolean
  onChange: (setting: GitHubInboundSetting) => void
}) {
  const intl = useIntl()
  const tickets = inboundMode === 'tickets'
  const teams = useQuery({ ...inboxTeamsQueryOptions(), enabled: tickets })
  const types = useQuery({ ...ticketQueries.types(), enabled: tickets })
  const customerTypes = (types.data ?? []).filter((t) => t.category === 'customer' && !t.archived)
  const setScope = (patch: Partial<GitHubTicketScope>) =>
    onChange({ inboundMode: 'tickets', ticketScope: { ...ticketScope, ...patch } })

  const modeLabel = (mode: GitHubInboundMode) =>
    mode === 'conversations'
      ? intl.formatMessage({
          id: 'admin.githubRepository.inboundMode.conversations',
          defaultMessage: 'Conversations',
        })
      : mode === 'tickets'
        ? intl.formatMessage({
            id: 'admin.githubRepository.inboundMode.tickets',
            defaultMessage: 'Tickets',
          })
        : intl.formatMessage({
            id: 'admin.githubRepository.inboundMode.off',
            defaultMessage: 'Off',
          })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={inboundMode}
        disabled={disabled}
        onValueChange={(mode) => onChange({ inboundMode: mode as GitHubInboundMode })}
      >
        <SelectTrigger
          className="h-8 w-40 text-xs"
          aria-label={intl.formatMessage(
            {
              id: 'admin.githubRepository.inboundMode',
              defaultMessage: 'What issues from {repository} open in the inbox',
            },
            { repository }
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(['off', 'conversations', 'tickets'] as const).map((mode) => (
            <SelectItem key={mode} value={mode}>
              {modeLabel(mode)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tickets && (
        <>
          <Select
            value={ticketScope.teamId ?? NONE}
            disabled={disabled}
            onValueChange={(teamId) => setScope({ teamId: teamId === NONE ? null : teamId })}
          >
            <SelectTrigger
              className="h-8 w-40 text-xs"
              aria-label={intl.formatMessage(
                {
                  id: 'admin.githubRepository.ticketTeam',
                  defaultMessage: 'Team for tickets from {repository}',
                },
                { repository }
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                {intl.formatMessage({
                  id: 'admin.githubRepository.ticketTeam.none',
                  defaultMessage: 'No team',
                })}
              </SelectItem>
              {(teams.data ?? []).map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={ticketScope.ticketTypeId ?? NONE}
            disabled={disabled}
            onValueChange={(ticketTypeId) =>
              setScope({ ticketTypeId: ticketTypeId === NONE ? null : ticketTypeId })
            }
          >
            <SelectTrigger
              className="h-8 w-44 text-xs"
              aria-label={intl.formatMessage(
                {
                  id: 'admin.githubRepository.ticketType',
                  defaultMessage: 'Ticket type for tickets from {repository}',
                },
                { repository }
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                {intl.formatMessage({
                  id: 'admin.githubRepository.ticketType.default',
                  defaultMessage: 'Default ticket type',
                })}
              </SelectItem>
              {customerTypes.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.icon ? `${type.icon} ${type.name}` : type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  )
}
