import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { FolderIcon, UserIcon } from '@heroicons/react/24/outline'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ModalFooter } from '@/components/shared/modal-footer'
import { AuthorSelector } from '@/components/shared/author-selector'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { TimeAgo } from '@/components/ui/time-ago'
import { adminQueries } from '@/lib/client/queries/admin'
import { SourceTypeIcon, SOURCE_TYPE_LABELS } from '../source-type-icon'
import { useSuggestionActions } from './use-suggestion-actions'
import type { SuggestionListItem } from '../feedback-types'

interface CreateFromSuggestionDialogProps {
  suggestion: SuggestionListItem | null
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreateFromSuggestionDialog({
  suggestion,
  onOpenChange,
  onCreated,
}: CreateFromSuggestionDialogProps) {
  return (
    <Dialog open={suggestion != null} onOpenChange={onOpenChange}>
      {suggestion && (
        <CreateFromSuggestionContent
          suggestion={suggestion}
          onClose={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      )}
    </Dialog>
  )
}

function CreateFromSuggestionContent({
  suggestion,
  onClose,
  onCreated,
}: {
  suggestion: SuggestionListItem
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState(suggestion.suggestedTitle ?? '')
  const [body, setBody] = useState(suggestion.suggestedBody ?? '')
  const [boardId, setBoardId] = useState(suggestion.board?.id ?? '')

  // Get current user's principalId from admin route context
  const context = useRouteContext({ from: '/admin' }) as {
    principal?: { id: string }
    user?: { name: string; email: string }
  }
  const currentPrincipalId = context.principal?.id ?? ''

  // Default author to current admin
  const [authorPrincipalId, setAuthorPrincipalId] = useState(currentPrincipalId)

  // Fetch team members and boards (already cached by admin layout)
  const { data: members = [] } = useQuery(adminQueries.teamMembers())
  const { data: boards = [] } = useQuery(adminQueries.boards())
  const { data: statuses = [] } = useQuery(adminQueries.statuses())

  const defaultStatusId = statuses.find((s) => s.isDefault)?.id || statuses[0]?.id || ''
  const [statusId, setStatusId] = useState('')

  // Set default status once loaded
  useEffect(() => {
    if (!statusId && defaultStatusId) {
      setStatusId(defaultStatusId)
    }
  }, [defaultStatusId, statusId])

  const selectedBoard = boards.find((b) => b.id === boardId)
  const selectedStatus = statuses.find((s) => s.id === statusId)

  const { accept, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: false,
    onResolved: onCreated,
  })

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return
    accept({
      title: title.trim(),
      body: body.trim(),
      boardId: boardId || undefined,
      statusId: statusId || undefined,
      authorPrincipalId: authorPrincipalId || undefined,
    })
  }, [title, body, boardId, statusId, authorPrincipalId, accept])

  const handleKeyDown = useKeyboardSubmit(handleSubmit, onClose)

  const rawItem = suggestion.rawItem
  const sourceType = rawItem?.sourceType ?? 'api'
  const author = rawItem?.author
  const snippet = rawItem?.content?.text ?? ''

  return (
    <DialogContent
      className="w-[95vw] max-w-5xl p-0 gap-0 overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      <DialogTitle className="sr-only">Create post from insight</DialogTitle>

      <div className="flex min-h-[380px]">
        {/* Left column: Content */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="space-y-4 p-4 sm:p-6 flex-1">
            {/* Source context banner */}
            {rawItem && (
              <div className="flex items-start gap-3 rounded-lg bg-muted/30 p-3">
                <SourceTypeIcon sourceType={sourceType} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {author?.name ??
                        author?.email ??
                        rawItem.source?.name ??
                        SOURCE_TYPE_LABELS[sourceType] ??
                        sourceType}
                    </span>
                    <TimeAgo
                      date={rawItem.sourceCreatedAt}
                      className="text-muted-foreground/60 shrink-0"
                    />
                  </div>
                  <ExpandableSnippet text={snippet} />
                </div>
              </div>
            )}

            {/* Title input */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              autoFocus
              className="w-full text-lg sm:text-xl font-semibold bg-transparent border-0 outline-none placeholder:text-muted-foreground/50 focus:ring-0"
            />

            {/* Body textarea */}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Description..."
              rows={5}
              className="w-full text-sm bg-transparent border-0 outline-none resize-none leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
            />

            {/* AI reasoning */}
            {suggestion.reasoning && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/30">
                <ChatBubbleLeftIcon className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {suggestion.reasoning}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar: Metadata */}
        <aside className="hidden lg:block w-64 shrink-0 border-l border-border/30 bg-muted/5">
          <div className="p-4 space-y-5">
            {/* Author */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserIcon className="h-4 w-4" />
                <span>Author</span>
              </div>
              <AuthorSelector
                members={members}
                value={authorPrincipalId}
                onChange={setAuthorPrincipalId}
              />
            </div>

            {/* Board */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FolderIcon className="h-4 w-4" />
                <span>Board</span>
              </div>
              <Select value={boardId} onValueChange={setBoardId}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder="Select board">
                    {selectedBoard?.name || 'Select board'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {boards.map((board) => (
                    <SelectItem key={board.id} value={board.id} className="text-xs">
                      {board.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">Status</span>
              <Select value={statusId} onValueChange={setStatusId}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue>
                    {selectedStatus && (
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: selectedStatus.color }}
                        />
                        {selectedStatus.name}
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((status) => (
                    <SelectItem key={status.id} value={status.id} className="text-xs">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: status.color }}
                        />
                        {status.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </aside>
      </div>

      <ModalFooter
        onCancel={onClose}
        submitLabel={isPending ? 'Creating...' : 'Create post'}
        isPending={isPending}
        submitDisabled={!title.trim()}
        hintAction="to create"
        submitType="button"
        onSubmit={handleSubmit}
      />
    </DialogContent>
  )
}

// ============================================================================
// Expandable Snippet
// ============================================================================

function ExpandableSnippet({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [isClamped, setIsClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) setIsClamped(el.scrollHeight > el.clientHeight + 1)
  }, [text])

  return (
    <div className="mt-1">
      {expanded ? (
        <>
          <div className="max-h-56 overflow-y-auto overscroll-contain scrollbar-thin">
            <p className="text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
              {text}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground mt-0.5 cursor-pointer"
          >
            Show less
          </button>
        </>
      ) : (
        <>
          <p
            ref={ref}
            className="text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap line-clamp-2"
          >
            {text}
          </p>
          {isClamped && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground mt-0.5 cursor-pointer"
            >
              Show full message
            </button>
          )}
        </>
      )}
    </div>
  )
}
