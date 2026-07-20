/**
 * The widget ticket thread (widget ticket submission): a port of the portal
 * `support.ticket.$ticketId.tsx`. Header (reference + title), the public-stage
 * `StageTracker`, the customer-visible thread via `VisitorMessageBubble` (the
 * visitor's own messages on the right, the team's on the left), an
 * `awaiting_requester` banner, and a rich-text reply composer. Ownership + the
 * internal-note strip are enforced by the widget requester fns.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { PaperAirplaneIcon } from '@heroicons/react/24/solid'
import { TicketIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { JSONContent } from '@tiptap/core'
import type { TicketId } from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/db-types'
import { DEFAULT_TICKET_STAGE_LABELS } from '@/lib/shared/tickets'
import {
  replyToMyWidgetTicketFn,
  markMyWidgetTicketReadFn,
} from '@/lib/server/functions/widget-tickets'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { widgetTicketKeys, widgetTicketQueries } from '@/lib/client/queries/widget-tickets'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { useWidgetAuth } from './widget-auth-provider'
import { VisitorMessageBubble } from '@/components/conversation/message-bubble'
import { SystemEventNotice } from '@/components/shared/conversation/system-event-notice'
import { StageTracker } from '@/components/shared/ticket-stage'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { VISITOR_CONVERSATION_FEATURES } from '@/components/conversation/conversation-editor-features'
import { useWidgetImageUpload } from '@/lib/client/hooks/use-image-upload'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface WidgetTicketDetailProps {
  ticketId: TicketId
}

/** Async-thread timestamps need the day, not just a clock time. */
function formatMessageTime(iso: string): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function WidgetTicketDetail({ ticketId }: WidgetTicketDetailProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const { sessionVersion } = useWidgetAuth()
  const replyJsonRef = useRef<TiptapContent | null>(null)
  const [hasContent, setHasContent] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const { upload } = useWidgetImageUpload()

  const {
    data: ticket,
    isLoading,
    isError,
  } = useQuery(widgetTicketQueries.detail(sessionVersion, ticketId))
  const { data: thread } = useQuery(widgetTicketQueries.thread(sessionVersion, ticketId))
  // B19: the tracker's stage labels come from the workspace's customized set
  // (same source as the chips/emails); the defaults stand in until they land.
  const { data: stageLabels } = useQuery(widgetTicketQueries.stageLabels(sessionVersion))

  // Read-through (convergence Phase 2): viewing the ticket marks the pair's
  // SHARED watermark read — on a linked pair the server writes the
  // CONVERSATION's visitor_last_read_at, so the Messages-tab row + the
  // messenger badge clear on the same read. Re-fires when a new message lands
  // while the detail is open. Fire-and-forget: a failed mark-read must never
  // break the view.
  const threadLoaded = !!thread
  const lastMessageId = thread?.messages?.[thread.messages.length - 1]?.id ?? null
  useEffect(() => {
    if (!threadLoaded) return
    void markMyWidgetTicketReadFn({ data: { ticketId }, headers: getWidgetAuthHeaders() })
      .then(() => {
        // Clear the badges that read the shared watermark: the Tickets-tab
        // rows, the Messages-tab list, and the messenger tab badge.
        void queryClient.invalidateQueries({ queryKey: widgetTicketKeys.list(sessionVersion) })
        void queryClient.invalidateQueries({
          queryKey: conversationKeys.widgetConversationList(sessionVersion),
        })
        void queryClient.invalidateQueries({
          queryKey: ['widget', 'messenger-unread', sessionVersion],
        })
      })
      .catch(() => {})
  }, [ticketId, sessionVersion, threadLoaded, lastMessageId, queryClient])

  const send = useMutation({
    mutationFn: (contentJson: TiptapContent | null) =>
      // `content` stays blank: the server derives the plaintext mirror from
      // `contentJson`, the same path a text-bearing doc always goes through.
      replyToMyWidgetTicketFn({
        data: { ticketId, content: '', contentJson },
        headers: getWidgetAuthHeaders(),
      }),
    onSuccess: () => {
      replyJsonRef.current = null
      setHasContent(false)
      setEditorKey((k) => k + 1)
      // Invalidate the whole tickets tree, not just the thread: a requester
      // reply auto-reopens the ticket (awaiting_requester → open), so the
      // detail-driven StageTracker/awaiting banner and the list's stage chip +
      // activity ordering would otherwise stay stale until they expire.
      void queryClient.invalidateQueries({ queryKey: widgetTicketKeys.all() })
    },
    onError: () => toast.error('Failed to send your reply'),
  })

  const handleEditorChange = useCallback((json: JSONContent) => {
    const doc = json as TiptapContent
    replyJsonRef.current = doc
    setHasContent(!isEmptyTiptapDoc(doc))
  }, [])

  const handleSend = useCallback(() => {
    const doc = replyJsonRef.current
    if (isEmptyTiptapDoc(doc ?? undefined) || send.isPending) return
    send.mutate(doc)
  }, [send])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (isError || !ticket) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          icon={TicketIcon}
          title={intl.formatMessage({
            id: 'widget.tickets.notFound.title',
            defaultMessage: 'Ticket not found',
          })}
          description={intl.formatMessage({
            id: 'widget.tickets.notFound.body',
            defaultMessage: 'It may have been removed, or you no longer have access.',
          })}
        />
      </div>
    )
  }

  const messages = thread?.messages ?? []
  const canSend = hasContent && !send.isPending

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 pb-4 pt-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground/70">
              {ticket.reference}
            </span>
          </div>
          <h1 className="text-base font-semibold leading-tight text-foreground">{ticket.title}</h1>
          <div className="mt-4">
            <StageTracker
              slot={ticket.stage.slot}
              closed={ticket.stage.closed}
              labels={stageLabels ?? DEFAULT_TICKET_STAGE_LABELS}
              closedLabelId="widget.tickets.stage.closed"
            />
          </div>

          <div className="mt-5 flex flex-col gap-3">
            {messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                <FormattedMessage
                  id="widget.tickets.thread.empty"
                  defaultMessage="No replies yet."
                />
              </p>
            ) : (
              messages.map((m) =>
                // B25: system events render as the centered muted notice,
                // localized from their structured event — never as an
                // agent-authored bubble of frozen English.
                m.senderType === 'system' ? (
                  <SystemEventNotice key={m.id} event={m.systemEvent} fallback={m.content} />
                ) : (
                  <VisitorMessageBubble
                    key={m.id}
                    content={m.content}
                    contentJson={m.contentJson}
                    side={m.senderType === 'visitor' ? 'self' : 'peer'}
                    authorName={m.author?.displayName ?? undefined}
                    isAssistant={m.isAssistant}
                    attachments={m.attachments}
                    citations={m.citations}
                    time={formatMessageTime(m.createdAt)}
                    getAuthHeaders={getWidgetAuthHeaders}
                  />
                )
              )
            )}
          </div>

          {ticket.stage.slot === 'awaiting_requester' && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-[13px] text-amber-700 dark:text-amber-400">
              <ChatBubbleLeftRightIcon className="size-4 shrink-0" />
              <FormattedMessage
                id="widget.tickets.awaitingReply"
                defaultMessage="The team is waiting on your reply."
              />
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/40 p-3">
        <div className="rounded-lg border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-primary/20">
          <RichTextEditor
            key={editorKey}
            borderless
            minHeight="64px"
            disabled={send.isPending}
            features={VISITOR_CONVERSATION_FEATURES}
            placeholder={intl.formatMessage({
              id: 'widget.tickets.reply.placeholder',
              defaultMessage: 'Reply to the team…',
            })}
            onChange={handleEditorChange}
            onImageUpload={upload}
            onSubmit={handleSend}
          />
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={handleSend} disabled={!canSend}>
              <PaperAirplaneIcon className="me-1.5 h-4 w-4 rtl:rotate-180" />
              <FormattedMessage id="widget.tickets.reply.send" defaultMessage="Send" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
