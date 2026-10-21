'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowPathIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import type { TicketId, TicketExternalLinkId } from '@quackback/ids'
import { ticketQueries, ticketKeys } from '@/lib/client/queries/inbox'
import {
  createTicketIssueFn,
  linkTicketIssueFn,
  syncTicketIntegrationsFn,
  unlinkTicketIssueFn,
} from '@/lib/server/functions/tickets'
import { INTEGRATION_ICON_MAP } from '@/components/icons/integration-icons'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** A repository new issues can be created in, for a tracker serving several. */
interface TrackerDestination {
  id: string
  name: string
}

interface TrackerLink {
  id: TicketExternalLinkId
  integrationType: string
  externalId: string
  externalDisplayId: string | null
  externalUrl: string | null
}

/**
 * The tracker section of the ticket detail panel: per connected tracker, link
 * the ticket to an existing issue (integrations with an `issues.parseRef`
 * capability) and/or create a new issue from the ticket (integrations with an
 * `issues.create` capability), list the linked issues, unlink, and, for a
 * tracker that mirrors replies and comments (`issues.comments`), sync the
 * ticket with its linked issues: replies with no comment yet go out, comments
 * not on the ticket yet come in. One section per tracker; hidden entirely
 * when nothing is connected and nothing is linked. Issue state changes flow
 * back via the inbound webhook's ticket status mapping, not this panel.
 */
export function TicketTrackerLinks({
  ticketId,
  onChanged,
}: {
  ticketId: TicketId
  onChanged: () => void
}) {
  const { data } = useQuery({ ...ticketQueries.externalLinks(ticketId), refetchInterval: 10_000 })
  if (!data) return null

  const linksByType = new Map<string, TrackerLink[]>()
  for (const link of data.links as TrackerLink[]) {
    const list = linksByType.get(link.integrationType) ?? []
    list.push(link)
    linksByType.set(link.integrationType, list)
  }

  // One section per connected linkable tracker, plus orphan sections for
  // links whose integration was later disconnected (still visible/removable).
  const sections: Array<{
    type: string
    name: string
    canLink: boolean
    canCreate: boolean
    canSync: boolean
    destinations: TrackerDestination[]
  }> = data.trackers.map((t) => ({
    type: t.integrationType,
    name: t.name,
    canLink: t.canLink,
    canCreate: t.canCreate,
    canSync: t.canSync,
    destinations: t.destinations,
  }))
  for (const type of linksByType.keys()) {
    if (!sections.some((s) => s.type === type)) {
      sections.push({
        type,
        name: type,
        canLink: false,
        canCreate: false,
        canSync: false,
        destinations: [],
      })
    }
  }
  if (sections.length === 0) return null

  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <TrackerSection
          key={s.type}
          ticketId={ticketId}
          type={s.type}
          name={s.name}
          canLink={s.canLink}
          canCreate={s.canCreate}
          canSync={s.canSync}
          destinations={s.destinations}
          links={linksByType.get(s.type) ?? []}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function TrackerSection({
  ticketId,
  type,
  name,
  canLink,
  canCreate,
  canSync,
  destinations,
  links,
  onChanged,
}: {
  ticketId: TicketId
  type: string
  name: string
  canLink: boolean
  canCreate: boolean
  /** Replies and comments sync with linked issues: a resync is offered while any are linked. */
  canSync: boolean
  /** Several repositories: creating asks which one. */
  destinations: TrackerDestination[]
  links: TrackerLink[]
  onChanged: () => void
}) {
  const intl = useIntl()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [issueRef, setIssueRef] = useState('')

  const settle = () => {
    void qc.invalidateQueries({ queryKey: ticketKeys.externalLinks(ticketId) })
    onChanged()
  }
  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : 'Could not update the link')

  const link = useMutation({
    mutationFn: (issue: string) =>
      linkTicketIssueFn({ data: { ticketId, issue, integrationType: type } }),
    onSuccess: () => {
      setIssueRef('')
      setAdding(false)
      settle()
    },
    onError,
  })
  const unlink = useMutation({
    mutationFn: (linkId: TicketExternalLinkId) =>
      unlinkTicketIssueFn({ data: { ticketId, linkId } }),
    onSuccess: settle,
    onError,
  })
  const create = useMutation({
    mutationFn: (destinationId?: string) =>
      createTicketIssueFn({ data: { ticketId, integrationType: type, destinationId } }),
    onSuccess: (result) => {
      settle()
      toast.message(
        result.state === 'succeeded'
          ? 'Issue already created'
          : ['queued', 'running', 'retry_wait'].includes(result.state)
            ? 'Issue creation queued'
            : 'This sync needs attention',
        {
          description: 'Review progress in the integration’s Sync history.',
        }
      )
    },
    onError,
  })

  const sync = useMutation({
    mutationFn: () => syncTicketIntegrationsFn({ data: { ticketId } }),
    onSuccess: (result) => {
      settle()
      toast.message(
        intl.formatMessage(
          { id: 'admin.ticketTracker.synced', defaultMessage: 'Sync with {tracker} queued' },
          { tracker: name }
        ),
        {
          description: intl.formatMessage(
            {
              id: 'admin.ticketTracker.syncCounts',
              defaultMessage: 'Comments to bring in: {inbound}. Replies to post: {outbound}.',
            },
            { inbound: result.inbound, outbound: result.outbound }
          ),
        }
      )
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error
          ? e.message
          : intl.formatMessage(
              {
                id: 'admin.ticketTracker.syncFailed',
                defaultMessage: 'Could not sync with {tracker}',
              },
              { tracker: name }
            )
      ),
  })

  const Icon = INTEGRATION_ICON_MAP[type]

  const submit = () => {
    const value = issueRef.trim()
    if (value && !link.isPending) link.mutate(value)
  }

  // With several repositories, "create" becomes one choice per repository;
  // a link's repository comes from the issue reference itself.
  const createItems =
    destinations.length > 1 ? (
      destinations.map((destination) => (
        <DropdownMenuItem key={destination.id} onClick={() => create.mutate(destination.id)}>
          {intl.formatMessage(
            { id: 'admin.ticketTracker.createIn', defaultMessage: 'Create issue in {repository}' },
            { repository: destination.name }
          )}
        </DropdownMenuItem>
      ))
    ) : (
      <DropdownMenuItem onClick={() => create.mutate(undefined)}>Create new issue</DropdownMenuItem>
    )

  // Both affordances (or a choice of repositories) → a menu; a single
  // affordance renders directly.
  const addBtnClass =
    'inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline'
  const addAffordance =
    canCreate && (canLink || destinations.length > 1) ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={addBtnClass} disabled={create.isPending}>
            <PlusIcon className="size-4" /> {create.isPending ? 'Creating…' : 'Add issue'}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canLink && (
            <DropdownMenuItem onClick={() => setAdding(true)}>
              Link existing issue…
            </DropdownMenuItem>
          )}
          {createItems}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : canLink ? (
      <button type="button" onClick={() => setAdding(true)} className={addBtnClass}>
        <PlusIcon className="size-4" /> Link issue
      </button>
    ) : canCreate ? (
      <button
        type="button"
        onClick={() => create.mutate(undefined)}
        disabled={create.isPending}
        className={addBtnClass}
      >
        <PlusIcon className="size-4" /> {create.isPending ? 'Creating…' : 'Create issue'}
      </button>
    ) : null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {Icon && <Icon className="h-4 w-4" />} {name}
        </span>
        <div className="flex items-center gap-3">
          {canSync && links.length > 0 && (
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowPathIcon className={`size-4 ${sync.isPending ? 'animate-spin' : ''}`} />
              {sync.isPending
                ? intl.formatMessage({
                    id: 'admin.ticketTracker.syncing',
                    defaultMessage: 'Syncing…',
                  })
                : intl.formatMessage(
                    { id: 'admin.ticketTracker.sync', defaultMessage: 'Sync with {tracker}' },
                    { tracker: name }
                  )}
            </button>
          )}
          {!adding && addAffordance}
        </div>
      </div>

      {adding && (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={issueRef}
            onChange={(e) => setIssueRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') {
                setAdding(false)
                setIssueRef('')
              }
            }}
            placeholder="Issue URL or reference"
            className="h-8 text-[13px]"
            disabled={link.isPending}
            aria-label={`${name} issue URL or reference`}
          />
          <button
            type="button"
            onClick={() => {
              setAdding(false)
              setIssueRef('')
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Cancel linking"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {links.length === 0 ? (
        !adding && <p className="text-sm text-muted-foreground">No linked issues</p>
      ) : (
        <ul className="space-y-0.5">
          {links.map((l) => (
            <li
              key={l.id}
              className="group flex items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50"
            >
              {l.externalUrl ? (
                <a
                  href={l.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-sm text-foreground hover:text-primary hover:underline"
                >
                  {l.externalDisplayId ?? l.externalId}
                </a>
              ) : (
                <span className="min-w-0 truncate text-sm">
                  {l.externalDisplayId ?? l.externalId}
                </span>
              )}
              <button
                type="button"
                onClick={() => unlink.mutate(l.id)}
                className="shrink-0 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
                aria-label={`Unlink ${l.externalDisplayId ?? l.externalId}`}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
