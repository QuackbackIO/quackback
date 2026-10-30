/**
 * Who is on a customer ticket, inside its header card (portal and widget, like
 * the card itself): the person who opened it and the customers it was shared
 * with. The requester can share it with colleagues from their own company (a
 * list of names, or an address typed in, matched only against that list) and
 * take off the people they added; anyone it was shared with can leave. Names
 * only, never anyone's email. Server rules live in ticket-sharing.service.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import type { PrincipalId, TicketId } from '@quackback/ids'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/shared/utils'
import { useVisitorSurfaceRpc } from '@/lib/client/visitor-surface-rpc'

export function ticketSharingKey(ticketId: TicketId) {
  return ['ticket-sharing', ticketId] as const
}

export function TicketPeople({
  ticketId,
  getAuthHeaders,
  onLeft,
}: {
  ticketId: TicketId
  getAuthHeaders: () => Record<string, string>
  /** Called after the viewer leaves the ticket (the thread is no longer theirs). */
  onLeft?: () => void
}) {
  const intl = useIntl()
  const rpc = useVisitorSurfaceRpc()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const { data: sharing } = useQuery({
    queryKey: ticketSharingKey(ticketId),
    queryFn: () => rpc.getMyTicketSharing({ data: { ticketId }, headers: getAuthHeaders() }),
    staleTime: 30_000,
  })
  const { data: colleagues } = useQuery({
    queryKey: [...ticketSharingKey(ticketId), 'colleagues'],
    queryFn: () => rpc.listMyTicketColleagues({ data: { ticketId }, headers: getAuthHeaders() }),
    enabled: expanded && sharing?.canShare === true,
    staleTime: 30_000,
  })

  const failed = () =>
    setNotice({
      tone: 'error',
      text: intl.formatMessage({
        id: 'portal.tickets.share.failed',
        defaultMessage: 'That did not work. Try again.',
      }),
    })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ticketSharingKey(ticketId) })

  const share = useMutation({
    mutationFn: (target: { principalId: PrincipalId } | { email: string }) =>
      rpc.shareMyTicket({ data: { ticketId, ...target }, headers: getAuthHeaders() }),
    onSuccess: () => {
      setEmail('')
      setNotice({
        tone: 'ok',
        text: intl.formatMessage({
          id: 'portal.tickets.share.shared',
          defaultMessage: 'Shared. They can now read and reply on this ticket.',
        }),
      })
      refresh()
    },
    onError: (error) => {
      if ((error as { code?: string } | null)?.code !== 'COLLEAGUE_NOT_FOUND') return failed()
      setNotice({
        tone: 'error',
        text: intl.formatMessage({
          id: 'portal.tickets.share.notFound',
          defaultMessage: 'No one in your company matches that email.',
        }),
      })
    },
  })
  const remove = useMutation({
    mutationFn: (principalId: PrincipalId) =>
      rpc.removeMyTicketShare({ data: { ticketId, principalId }, headers: getAuthHeaders() }),
    onSuccess: (_data, principalId) => {
      const left = sharing?.people.find((p) => p.principalId === principalId)?.isMe
      if (left) {
        onLeft?.()
        return
      }
      setNotice(null)
      refresh()
    },
    onError: failed,
  })

  if (!sharing) return null
  const others = sharing.people.filter((p) => !p.isRequester)
  // Nothing to show to a requester who can't share and has shared with no one.
  if (others.length === 0 && !sharing.canShare) return null

  const youLabel = intl.formatMessage({ id: 'portal.tickets.share.you', defaultMessage: 'You' })
  const pending = share.isPending || remove.isPending

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRightIcon
          className={cn(
            'size-3.5 transition-transform rtl:rotate-180',
            expanded && 'rotate-90 rtl:rotate-90'
          )}
        />
        <FormattedMessage id="portal.tickets.share.toggle" defaultMessage="People" />
        <span className="text-muted-foreground/60">· {sharing.people.length}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 rounded-md border border-border/40 bg-background/60 px-2.5 py-2">
          <ul className="space-y-1.5">
            {sharing.people.map((person) => (
              <li key={person.principalId} className="flex items-center gap-2 text-xs">
                <Avatar
                  src={person.avatarUrl}
                  name={person.displayName ?? '?'}
                  className="size-5 shrink-0 text-[11px]"
                />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {person.isMe
                    ? youLabel
                    : (person.displayName ??
                      intl.formatMessage({
                        id: 'portal.tickets.share.colleague',
                        defaultMessage: 'A colleague',
                      }))}
                  {person.isRequester && (
                    <span className="ms-1 text-muted-foreground">
                      <FormattedMessage
                        id="portal.tickets.share.openedIt"
                        defaultMessage="opened this ticket"
                      />
                    </span>
                  )}
                </span>
                {person.canRemove && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove.mutate(person.principalId)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {person.isMe ? (
                      <FormattedMessage id="portal.tickets.share.leave" defaultMessage="Leave" />
                    ) : (
                      <FormattedMessage id="portal.tickets.share.remove" defaultMessage="Remove" />
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {sharing.canShare && (
            <div className="space-y-1.5 border-t border-border/40 pt-2">
              <p className="text-[11px] text-muted-foreground">
                <FormattedMessage
                  id="portal.tickets.share.help"
                  defaultMessage="Share this ticket with colleagues from your company. They can read and reply on it and get its updates."
                />
              </p>
              {(colleagues?.colleagues ?? []).length > 0 ? (
                <ul className="max-h-32 space-y-1 overflow-y-auto">
                  {colleagues!.colleagues.map((c) => (
                    <li key={c.principalId} className="flex items-center gap-2 text-xs">
                      <Avatar
                        src={c.avatarUrl}
                        name={c.displayName ?? '?'}
                        className="size-5 shrink-0 text-[11px]"
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {c.displayName ??
                          intl.formatMessage({
                            id: 'portal.tickets.share.colleague',
                            defaultMessage: 'A colleague',
                          })}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => share.mutate({ principalId: c.principalId })}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <FormattedMessage id="portal.tickets.share.add" defaultMessage="Share" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground/70">
                  <FormattedMessage
                    id="portal.tickets.share.noColleagues"
                    defaultMessage="No colleagues to suggest. You can type a colleague's email."
                  />
                </p>
              )}
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  const value = email.trim()
                  if (value) share.mutate({ email: value })
                }}
              >
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={intl.formatMessage({
                    id: 'portal.tickets.share.emailPlaceholder',
                    defaultMessage: "Colleague's email",
                  })}
                  aria-label={intl.formatMessage({
                    id: 'portal.tickets.share.emailPlaceholder',
                    defaultMessage: "Colleague's email",
                  })}
                  className="h-7 text-xs"
                />
                <Button type="submit" size="sm" disabled={pending || !email.trim()}>
                  <FormattedMessage id="portal.tickets.share.add" defaultMessage="Share" />
                </Button>
              </form>
            </div>
          )}

          {notice && (
            <p
              role="status"
              className={cn(
                'text-[11px]',
                notice.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {notice.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
