import { useState, useCallback } from 'react'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { TimeAgo } from '@/components/ui/time-ago'
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

  const { accept, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: false,
    onResolved: onCreated,
  })

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return
    accept({ title: title.trim(), body: body.trim() })
  }, [title, body, accept])

  const handleKeyDown = useKeyboardSubmit(handleSubmit, onClose)

  const rawItem = suggestion.rawItem
  const sourceType = rawItem?.sourceType ?? 'api'
  const author = rawItem?.author
  const snippet = rawItem?.content?.text ?? ''

  return (
    <DialogContent
      className="w-[95vw] max-w-2xl p-0 gap-0 overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      <DialogTitle className="sr-only">Create post from insight</DialogTitle>

      <div className="space-y-4 p-4 sm:p-6">
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
              <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
                {snippet}
              </p>
            </div>
          </div>
        )}

        {/* Board badge */}
        {suggestion.board && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/60">Board</span>
            <Badge variant="outline" className="text-[10px]">
              {suggestion.board.name}
            </Badge>
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
            <p className="text-xs text-muted-foreground leading-relaxed">{suggestion.reasoning}</p>
          </div>
        )}
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
