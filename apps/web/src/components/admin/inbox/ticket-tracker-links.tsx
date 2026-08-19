'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { TicketId, TicketExternalLinkId } from '@quackback/ids'
import { ticketQueries, ticketKeys } from '@/lib/client/queries/inbox'
import {
  createTicketIssueFn,
  linkTicketIssueFn,
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
 * `issues.create` capability), list the linked issues, unlink. One section per
 * tracker; hidden entirely when nothing is connected and nothing is linked.
 * Issue state changes flow back via the inbound webhook's ticket status
 * mapping, not this panel.
 */
export function TicketTrackerLinks({
  ticketId,
  onChanged,
}: {
  ticketId: TicketId
  onChanged: () => void
}) {
  const { data } = useQuery(ticketQueries.externalLinks(ticketId))
  if (!data) return null

  const linksByType = new Map<string, TrackerLink[]>()
  for (const link of data.links as TrackerLink[]) {
    const list = linksByType.get(link.integrationType) ?? []
    list.push(link)
    linksByType.set(link.integrationType, list)
  }

  // One section per connected linkable tracker, plus orphan sections for
  // links whose integration was later disconnected (still visible/removable).
  const sections: Array<{ type: string; name: string; canLink: boolean; canCreate: boolean }> =
    data.trackers.map(
      (t: { integrationType: string; name: string; canLink: boolean; canCreate: boolean }) => ({
        type: t.integrationType,
        name: t.name,
        canLink: t.canLink,
        canCreate: t.canCreate,
      })
    )
  for (const type of linksByType.keys()) {
    if (!sections.some((s) => s.type === type)) {
      sections.push({ type, name: type, canLink: false, canCreate: false })
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
  links,
  onChanged,
}: {
  ticketId: TicketId
  type: string
  name: string
  canLink: boolean
  canCreate: boolean
  links: TrackerLink[]
  onChanged: () => void
}) {
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
    mutationFn: () => createTicketIssueFn({ data: { ticketId, integrationType: type } }),
    onSuccess: settle,
    onError,
  })

  const Icon = INTEGRATION_ICON_MAP[type]

  const submit = () => {
    const value = issueRef.trim()
    if (value && !link.isPending) link.mutate(value)
  }

  // Both affordances → a two-item menu; a single affordance renders directly.
  const addBtnClass =
    'inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline'
  const addAffordance =
    canLink && canCreate ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={addBtnClass} disabled={create.isPending}>
            <PlusIcon className="size-4" /> {create.isPending ? 'Creating…' : 'Add issue'}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setAdding(true)}>Link existing issue…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => create.mutate()}>Create new issue</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : canLink ? (
      <button type="button" onClick={() => setAdding(true)} className={addBtnClass}>
        <PlusIcon className="size-4" /> Link issue
      </button>
    ) : canCreate ? (
      <button
        type="button"
        onClick={() => create.mutate()}
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
        {!adding && addAffordance}
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
