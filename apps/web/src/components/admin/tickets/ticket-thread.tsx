/**
 * The agent-facing ticket thread (support platform §4.2, 7C): a virtualized
 * message list + reply/internal-note composer for a customer ticket. Built on the
 * SAME shared thread core as the conversation inbox (thread.tsx + AgentMessageBubble)
 * and the SAME unified RichTextEditor, but far leaner: a ticket carries no CSAT /
 * typing / convert-to-post / macros, and the message bubble renders read-only (no
 * inbox reactions/flags/delete toolbar). Live SSE arrives with the requester
 * surfaces; for now a send optimistically appends and the query refetches on focus.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PaperAirplaneIcon, PaperClipIcon, PencilSquareIcon } from '@heroicons/react/24/solid'
import type { TicketId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/core'
import type { TiptapContent } from '@/lib/shared/db-types'
import type {
  ConversationAttachment,
  ConversationMessageDTO,
} from '@/lib/shared/conversation/types'
import {
  sendTicketMessageFn,
  addTicketNoteFn,
  listTicketMessagesFn,
} from '@/lib/server/functions/tickets'
import { ticketQueries, ticketKeys } from '@/lib/client/queries/tickets'
import { AgentMessageBubble } from '@/components/conversation/message-bubble'
import { asAgentMessage } from '@/components/conversation/events-reducer'
import { ThreadViewport, useThreadVirtualizer } from '@/components/conversation/thread'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import {
  CONVERSATION_EDITOR_FEATURES,
  CONVERSATION_NOTE_FEATURES,
} from '@/components/conversation/conversation-editor-features'
import { ComposerAttachmentTray } from '@/components/shared/composer-attachment-tray'
import { Spinner } from '@/components/shared/spinner'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { useConversationComposerAttachments } from '@/lib/client/hooks/use-conversation-composer-attachments'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { cn } from '@/lib/shared/utils'

interface TicketThreadCache {
  messages: ConversationMessageDTO[]
  hasMore: boolean
}

type Row = { key: string } & (
  | { type: 'message'; message: ConversationMessageDTO }
  | { type: 'load-older' }
  | { type: 'empty' }
)

/** A composer's live draft: the rich doc (persisted as contentJson) plus the
 *  derived markdown mirror (stored as `content` for FTS/preview/transcripts). */
type ComposerDraft = { json: TiptapContent | null; markdown: string }
const EMPTY_DRAFT: ComposerDraft = { json: null, markdown: '' }

export function TicketThread({ ticketId }: { ticketId: TicketId }) {
  const queryClient = useQueryClient()
  const threadKey = ticketKeys.thread(ticketId)

  // Reply and Note keep independent drafts, so toggling modes preserves each
  // mode's in-progress text/images (matches the previous two-editor setup). The
  // reset key force-remounts the active editor to clear it after a send — the
  // same pattern the comment composer uses (an empty controlled value leaves a
  // stale `<p></p>` that traps the cursor; a remount is the clean reset).
  const [noteMode, setNoteMode] = useState(false)
  const [replyDraft, setReplyDraft] = useState<ComposerDraft>(EMPTY_DRAFT)
  const [noteDraft, setNoteDraft] = useState<ComposerDraft>(EMPTY_DRAFT)
  const [replyKey, setReplyKey] = useState(0)
  const [noteKey, setNoteKey] = useState(0)

  const [loadingOlder, setLoadingOlder] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery(ticketQueries.thread(ticketId))
  const messages = data?.messages ?? []
  const hasMoreOlder = data?.hasMore ?? false

  const { upload } = useImageUpload({ endpoint: '/api/upload/image', prefix: 'chat-images' })
  const {
    pending: pendingAttachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    uploading,
  } = useConversationComposerAttachments(upload)

  const rows: Row[] = useMemo(() => {
    const r: Row[] = []
    if (hasMoreOlder) r.push({ key: 'load-older', type: 'load-older' })
    for (const m of messages) r.push({ key: m.id, type: 'message', message: m })
    if (messages.length === 0 && !isLoading) r.push({ key: 'empty', type: 'empty' })
    return r
  }, [messages, hasMoreOlder, isLoading])

  const virtualizer = useThreadVirtualizer({
    rows,
    scrollRef,
    estimateSize: 72,
    loading: isLoading,
  })

  // After our own send lands, jump to the freshly-appended row. Deferred to a
  // layout effect so the new row exists in `rows` before we scroll.
  const pendingOwnSendScroll = useRef(false)
  useLayoutEffect(() => {
    if (!pendingOwnSendScroll.current || rows.length === 0) return
    pendingOwnSendScroll.current = false
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [rows.length, virtualizer])

  const append = (message: ConversationMessageDTO) => {
    queryClient.setQueryData<TicketThreadCache>(threadKey, (prev) => ({
      messages: [...(prev?.messages ?? []), message],
      hasMore: prev?.hasMore ?? false,
    }))
    pendingOwnSendScroll.current = true
  }

  const loadOlder = useCallback(async () => {
    if (loadingOlder || messages.length === 0) return
    setLoadingOlder(true)
    try {
      const page = await listTicketMessagesFn({ data: { ticketId, before: messages[0].id } })
      queryClient.setQueryData<TicketThreadCache>(threadKey, (prev) => ({
        messages: [...page.messages, ...(prev?.messages ?? [])],
        hasMore: page.hasMore,
      }))
    } catch {
      toast.error('Failed to load older messages')
    } finally {
      setLoadingOlder(false)
    }
  }, [ticketId, messages, loadingOlder, queryClient, threadKey])

  const sendMutation = useMutation({
    mutationFn: (vars: {
      content: string
      contentJson: JSONContent | null
      attachments?: ConversationAttachment[]
    }) => sendTicketMessageFn({ data: { ticketId, ...vars } }),
    onSuccess: (res) => {
      clearAttachments()
      append(res.message)
    },
    onError: () => toast.error('Failed to send reply'),
  })

  const noteMutation = useMutation({
    mutationFn: (vars: {
      content: string
      contentJson: JSONContent | null
      attachments?: ConversationAttachment[]
    }) => addTicketNoteFn({ data: { ticketId, ...vars } }),
    onSuccess: (res) => {
      clearAttachments()
      append(res.message)
    },
    onError: () => toast.error('Failed to add note'),
  })

  // A message is sendable when the doc carries text or an inline image/embed
  // (isEmptyTiptapDoc counts any non-text node as content), OR a file is staged
  // in the tray. `content` is stored as the doc's markdown; `contentJson` holds
  // the doc (null when it's only an attachment). Text/doc clear optimistically on
  // send; tray attachments clear in the mutation's onSuccess.
  const onReplyChange = useCallback(
    (json: JSONContent, _html: string, markdown: string) =>
      setReplyDraft({ json: json as TiptapContent, markdown }),
    []
  )
  const onNoteChange = useCallback(
    (json: JSONContent, _html: string, markdown: string) =>
      setNoteDraft({ json: json as TiptapContent, markdown }),
    []
  )

  // Enter-to-send routes here, so it must be a STABLE callback — an inline arrow
  // would churn the editor's extension identity on every keystroke. Read the
  // latest state through a ref refreshed each render.
  const sendRef = useRef<() => void>(() => {})
  sendRef.current = () => {
    const draft = noteMode ? noteDraft : replyDraft
    const empty = isEmptyTiptapDoc(draft.json ?? undefined)
    const hasAttachments = pendingAttachments.length > 0
    const mutation = noteMode ? noteMutation : sendMutation
    if ((empty && !hasAttachments) || mutation.isPending || uploading) return
    mutation.mutate({
      content: draft.markdown.trim(),
      contentJson: empty ? null : draft.json,
      attachments: hasAttachments ? pendingAttachments : undefined,
    })
    if (noteMode) {
      setNoteDraft(EMPTY_DRAFT)
      setNoteKey((k) => k + 1)
    } else {
      setReplyDraft(EMPTY_DRAFT)
      setReplyKey((k) => k + 1)
    }
  }
  const onSend = useCallback(() => sendRef.current(), [])

  const activeDraft = noteMode ? noteDraft : replyDraft
  const activePending = noteMode ? noteMutation.isPending : sendMutation.isPending
  const sendDisabled =
    (isEmptyTiptapDoc(activeDraft.json ?? undefined) && pendingAttachments.length === 0) ||
    activePending ||
    uploading

  const renderRow = (row: Row) => {
    switch (row.type) {
      case 'load-older':
        return (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="rounded-full border border-border/60 px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )
      case 'message':
        return <AgentMessageBubble message={asAgentMessage(row.message)} readOnly />
      case 'empty':
        return (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No replies yet. Send the first message to the requester.
          </p>
        )
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ThreadViewport
          virtualizer={virtualizer}
          rows={rows}
          renderRow={renderRow}
          viewportRef={scrollRef}
          className="min-h-0 flex-1"
          rowClassName="px-5 py-1.5"
        />
      </div>

      {/* Composer */}
      <div className="border-t border-border/50 p-3">
        <div className="mb-2 flex gap-1">
          {(
            [
              { mode: false, label: 'Reply' },
              { mode: true, label: 'Note' },
            ] as const
          ).map(({ mode, label }) => (
            <button
              key={label}
              type="button"
              onClick={() => setNoteMode(mode)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                noteMode === mode
                  ? mode
                    ? 'bg-amber-400/20 text-amber-700 dark:text-amber-300'
                    : 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className={cn(
            'rounded-lg border px-3 py-2 focus-within:ring-2',
            noteMode
              ? 'border-amber-400/50 bg-amber-400/5 focus-within:ring-amber-400/20'
              : 'border-border bg-background focus-within:ring-primary/20'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files
              if (files && files.length > 0) void addFiles(files)
              e.target.value = ''
            }}
          />
          {/* Reply and Note share the unified RichTextEditor; the note preset only
              differs by intent (a place to diverge later). Enter sends, Shift+Enter
              breaks; formatting comes from the editor's own bubble/slash/`:` surfaces.
              Pasted/dropped images inline via onImageUpload; the paperclip still
              stages files in the tray below. */}
          {noteMode ? (
            <RichTextEditor
              key={`note-${noteKey}`}
              value={noteDraft.json ?? ''}
              features={CONVERSATION_NOTE_FEATURES}
              borderless
              minHeight="1.5rem"
              autofocus={noteKey > 0 ? 'end' : false}
              disabled={noteMutation.isPending}
              placeholder="Add an internal note for your team…"
              className="max-h-32 overflow-y-auto"
              onChange={onNoteChange}
              onSubmit={onSend}
              onImageUpload={upload}
            />
          ) : (
            <RichTextEditor
              key={`reply-${replyKey}`}
              value={replyDraft.json ?? ''}
              features={CONVERSATION_EDITOR_FEATURES}
              borderless
              minHeight="1.5rem"
              autofocus={replyKey > 0 ? 'end' : false}
              disabled={sendMutation.isPending}
              placeholder="Reply to the requester…"
              className="max-h-32 overflow-y-auto"
              onChange={onReplyChange}
              onSubmit={onSend}
              onImageUpload={upload}
            />
          )}
          <ComposerAttachmentTray attachments={pendingAttachments} onRemove={removeAttachment} />
          <div className="flex items-center gap-0.5 pt-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              aria-label="Attach image"
            >
              <PaperClipIcon className="h-4 w-4" />
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onSend}
              disabled={sendDisabled}
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md text-primary-foreground disabled:opacity-40 transition-opacity',
                noteMode ? 'bg-amber-500 text-white' : 'bg-primary'
              )}
              aria-label={noteMode ? 'Add note' : 'Send reply'}
            >
              {noteMode ? (
                <PencilSquareIcon className="h-4 w-4" />
              ) : (
                <PaperAirplaneIcon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
