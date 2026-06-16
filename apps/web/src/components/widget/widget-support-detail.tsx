import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import { FormattedMessage, useIntl } from 'react-intl'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TicketThreadFeed, type ThreadRow } from '@/components/admin/tickets/ticket-thread-feed'
import {
  getWidgetTicket,
  replyToWidgetTicket,
  reopenWidgetTicket,
  resolveWidgetTicket,
  updateWidgetTicketDescription,
  WidgetTicketError,
  type WidgetTicketDetailResponse,
  type WidgetTicketThread,
  type StatusCategory,
} from '@/lib/client/widget/tickets-api'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetSupportDetailProps {
  ticketId: string
}

const RESOLVED_CATEGORIES: ReadonlySet<StatusCategory> = new Set(['solved', 'closed'])
const REOPENABLE_CATEGORIES: ReadonlySet<StatusCategory> = new Set(['solved'])

export function WidgetSupportDetail({ ticketId }: WidgetSupportDetailProps) {
  const intl = useIntl()
  const { sessionVersion, emitEvent } = useWidgetAuth()
  const queryClient = useQueryClient()

  const queryKey = ['widget', 'tickets', 'detail', ticketId, sessionVersion]
  const { data, isLoading, error } = useQuery<WidgetTicketDetailResponse>({
    queryKey,
    queryFn: () => getWidgetTicket(ticketId),
    refetchOnWindowFocus: true,
    staleTime: 10 * 1000,
  })

  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [reopening, setReopening] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)
  const [savingDescription, setSavingDescription] = useState(false)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)

  const isResolved = data ? RESOLVED_CATEGORIES.has(data.ticket.statusCategory) : false
  const canReopen = data ? REOPENABLE_CATEGORIES.has(data.ticket.statusCategory) : false

  const handleReply = useCallback(async () => {
    const text = reply.trim()
    if (!text || replying) return
    setReplying(true)
    setReplyError(null)
    try {
      const result = await replyToWidgetTicket(ticketId, text)
      emitEvent('ticket:replied', { ticketId, threadId: result.id })
      setReply('')
      await queryClient.invalidateQueries({ queryKey })
    } catch (err) {
      setReplyError(
        err instanceof WidgetTicketError
          ? err.message
          : intl.formatMessage({
              id: 'widget.support.detail.errorReply',
              defaultMessage: 'Could not post your reply.',
            })
      )
    } finally {
      setReplying(false)
    }
  }, [reply, replying, ticketId, emitEvent, queryClient, queryKey, intl])

  const handleResolve = useCallback(async () => {
    if (resolving || isResolved) return
    setResolving(true)
    setResolveError(null)
    try {
      const result = await resolveWidgetTicket(ticketId)
      emitEvent('ticket:resolved', {
        ticketId,
        statusId: result.statusId,
        alreadyResolved: result.alreadyResolved,
      })
      await queryClient.invalidateQueries({ queryKey })
    } catch (err) {
      setResolveError(
        err instanceof WidgetTicketError
          ? err.message
          : intl.formatMessage({
              id: 'widget.support.detail.errorResolve',
              defaultMessage: 'Could not mark this ticket as resolved.',
            })
      )
    } finally {
      setResolving(false)
    }
  }, [resolving, isResolved, ticketId, emitEvent, queryClient, queryKey, intl])

  const handleReopen = useCallback(async () => {
    if (reopening || !canReopen) return
    setReopening(true)
    setReopenError(null)
    try {
      const result = await reopenWidgetTicket(ticketId)
      emitEvent('ticket:reopened', {
        ticketId,
        statusId: result.statusId,
        alreadyOpen: result.alreadyOpen,
      })
      await queryClient.invalidateQueries({ queryKey })
    } catch (err) {
      setReopenError(
        err instanceof WidgetTicketError
          ? err.message
          : intl.formatMessage({
              id: 'widget.support.detail.errorReopen',
              defaultMessage: 'Could not reopen this ticket.',
            })
      )
    } finally {
      setReopening(false)
    }
  }, [reopening, canReopen, ticketId, emitEvent, queryClient, queryKey, intl])

  const handleDescriptionUpdate = useCallback(
    async (json: JSONContent | null, text: string | null) => {
      if (!data || savingDescription) return
      setSavingDescription(true)
      setDescriptionError(null)
      try {
        const latest = queryClient.getQueryData<WidgetTicketDetailResponse>(queryKey)
        const result = await updateWidgetTicketDescription(ticketId, {
          expectedUpdatedAt: latest?.ticket.updatedAt ?? data.ticket.updatedAt,
          descriptionJson: json as { type: 'doc'; content?: unknown[] } | null,
          descriptionText: text,
        })
        emitEvent('ticket:description_updated', { ticketId, updatedAt: result.updatedAt })
        queryClient.setQueryData<WidgetTicketDetailResponse | undefined>(queryKey, (current) =>
          current
            ? { ...current, ticket: { ...current.ticket, updatedAt: result.updatedAt } }
            : current
        )
        await queryClient.invalidateQueries({ queryKey })
      } catch (err) {
        setDescriptionError(
          err instanceof WidgetTicketError
            ? err.message
            : intl.formatMessage({
                id: 'widget.support.detail.errorDescription',
                defaultMessage: 'Could not update the description.',
              })
        )
      } finally {
        setSavingDescription(false)
      }
    },
    [data, savingDescription, ticketId, emitEvent, queryClient, queryKey, intl]
  )

  if (isLoading) {
    return (
      <div className="flex flex-col h-full px-3 pt-3">
        <div className="space-y-3 animate-pulse">
          <div className="h-5 bg-muted/50 rounded w-3/4" />
          <div className="h-3 bg-muted/30 rounded w-1/3" />
          <div className="h-20 bg-muted/30 rounded mt-2" />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <p className="text-sm text-muted-foreground">
          <FormattedMessage
            id="widget.support.detail.errorLoad"
            defaultMessage="Could not load this ticket."
          />
        </p>
      </div>
    )
  }

  const { ticket, threads, principalNames, viewerPrincipalId } = data
  const feedThreads: ThreadRow[] = threads.map((t) => ({
    id: t.id,
    ticketId: ticket.id,
    principalId: t.principalId,
    audience: 'public',
    bodyJson: t.bodyJson,
    bodyText: threadText(t),
    sharedWithTeamId: null,
    createdAt: t.createdAt,
    editedAt: t.editedAt,
  }))

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2 pb-2 shrink-0 border-b border-border/40">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground line-clamp-2">{ticket.subject}</h2>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ backgroundColor: ticket.statusColor ?? '#94a3b8' }}
              />
              <span className="text-[11px] text-muted-foreground">
                {isResolved ? (
                  <FormattedMessage id="widget.support.detail.resolved" defaultMessage="Resolved" />
                ) : (
                  ticket.statusName
                )}
              </span>
              <span className="text-[11px] text-muted-foreground/60">·</span>
              <span className="text-[11px] text-muted-foreground/60">
                <TimeAgo date={ticket.createdAt} />
              </span>
            </div>
          </div>
          {!isResolved && (
            <button
              type="button"
              onClick={handleResolve}
              disabled={resolving}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 text-[11px] font-medium text-foreground hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <CheckCircleIcon className="w-3 h-3" />
              <FormattedMessage
                id="widget.support.detail.resolve"
                defaultMessage="Mark as resolved"
              />
            </button>
          )}
          {canReopen && (
            <button
              type="button"
              onClick={handleReopen}
              disabled={reopening}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 text-[11px] font-medium text-foreground hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <ArrowUturnLeftIcon className="w-3 h-3" />
              <FormattedMessage id="widget.support.detail.reopen" defaultMessage="Reopen" />
            </button>
          )}
        </div>
        {resolveError && <p className="text-[11px] text-destructive mt-1">{resolveError}</p>}
        {reopenError && <p className="text-[11px] text-destructive mt-1">{reopenError}</p>}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 py-3 space-y-3">
          {descriptionError && <p className="text-[11px] text-destructive">{descriptionError}</p>}
          <TicketThreadFeed
            threads={feedThreads}
            principalNames={{
              ...principalNames,
              ...(viewerPrincipalId
                ? {
                    [viewerPrincipalId]: intl.formatMessage({
                      id: 'widget.support.detail.youLabel',
                      defaultMessage: 'You',
                    }),
                  }
                : {}),
            }}
            description={
              ticket.descriptionText || ticket.descriptionJson
                ? { text: ticket.descriptionText, json: ticket.descriptionJson }
                : null
            }
            onDescriptionUpdate={!isResolved ? handleDescriptionUpdate : undefined}
            isDescriptionSaving={savingDescription}
          />
        </div>
      </ScrollArea>

      {!isResolved && (
        <div className="px-3 py-2 border-t border-border/40 shrink-0">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            disabled={replying}
            placeholder={intl.formatMessage({
              id: 'widget.support.detail.replyPlaceholder',
              defaultMessage: 'Type your reply...',
            })}
            className="w-full min-h-[52px] max-h-[120px] resize-none rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-50 transition-colors"
          />
          <div className="flex items-center justify-end gap-2 mt-1.5">
            {replyError && (
              <p className="text-[11px] text-destructive flex-1 line-clamp-1">{replyError}</p>
            )}
            <button
              type="button"
              onClick={handleReply}
              disabled={!reply.trim() || replying}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {replying ? (
                <FormattedMessage
                  id="widget.support.detail.replySending"
                  defaultMessage="Sending..."
                />
              ) : (
                <FormattedMessage id="widget.support.detail.replySend" defaultMessage="Reply" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function threadText(t: WidgetTicketThread): string {
  if (t.bodyText) return t.bodyText
  return ''
}
