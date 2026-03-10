import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HandThumbUpIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { CompactPostCard } from '@/components/shared/compact-post-card'
import { ExpandableQuote } from '@/components/shared/expandable-quote'
import { TimeAgo } from '@/components/ui/time-ago'
import { SourceTypeIcon, SOURCE_TYPE_LABELS } from '../source-type-icon'
import { useSuggestionActions } from './use-suggestion-actions'
import { useDismissTimer } from './use-dismiss-timer'
import { dismissSuggestionFn, restoreSuggestionFn } from '@/lib/server/functions/feedback'
import { suggestionsKeys } from '@/lib/client/hooks/use-suggestions-query'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import type { SuggestionListItem, SuggestionGroup } from '../feedback-types'

// ─── Group component ────────────────────────────────────────────────

interface SuggestionSourceGroupProps {
  group: SuggestionGroup
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
  readOnly?: boolean
}

export function SuggestionSourceGroup({
  group,
  onCreatePost,
  onResolved,
  readOnly,
}: SuggestionSourceGroupProps) {
  const queryClient = useQueryClient()
  const rawItem = group.rawItem
  // Derive header info from rawItem when available, otherwise from the first suggestion
  const firstSuggestion = group.suggestions[0]
  const sourceType = rawItem?.sourceType ?? firstSuggestion.rawItem?.sourceType ?? 'api'
  const author = rawItem?.author ?? firstSuggestion.rawItem?.author
  const authorLabel = author?.name ?? author?.email ?? rawItem?.source?.name ?? sourceType
  const headerDate = rawItem?.sourceCreatedAt ?? firstSuggestion.createdAt
  const originalText = rawItem?.content?.text ?? ''
  const allIds = group.suggestions.map((s) => s.id)

  // Pending dismiss state
  const [pendingDismissIds, setPendingDismissIds] = useState<Set<string>>(new Set())
  const [capturedHeights, setCapturedHeights] = useState<Map<string, number>>(new Map())

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: suggestionsKeys.all })
    queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
    queryClient.invalidateQueries({ queryKey: feedbackQueries.incomingCount().queryKey })
  }, [queryClient])

  // Timer only controls when the placeholder disappears + queries refetch
  const { startTimer, cancelTimer } = useDismissTimer({
    onConfirm: (id: string) => {
      setPendingDismissIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setCapturedHeights((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      invalidate()
    },
  })

  const handleStartDismiss = useCallback(
    (id: string, height: number) => {
      // Fire mutation immediately
      dismissSuggestionFn({ data: { id } })
      // Show placeholder
      setPendingDismissIds((prev) => new Set(prev).add(id))
      setCapturedHeights((prev) => new Map(prev).set(id, height))
      startTimer(id)
    },
    [startTimer]
  )

  const handleUndo = useCallback(
    (id: string) => {
      cancelTimer(id)
      setPendingDismissIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setCapturedHeights((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      // Restore server-side, then refetch
      restoreSuggestionFn({ data: { id } }).then(() => invalidate())
    },
    [cancelTimer, invalidate]
  )

  const handleDismissAll = useCallback(() => {
    for (const s of group.suggestions) {
      if (!pendingDismissIds.has(s.id)) {
        handleStartDismiss(s.id, capturedHeights.get(s.id) ?? 52)
      }
    }
  }, [group.suggestions, handleStartDismiss, capturedHeights, pendingDismissIds])

  const hasPending = pendingDismissIds.size > 0

  return (
    <div className="w-full px-4 py-3 space-y-2">
      {/* Source header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SourceTypeIcon sourceType={sourceType} size="sm" />
          <span className="text-[11px] font-medium text-muted-foreground/70">
            {SOURCE_TYPE_LABELS[sourceType] ?? sourceType}
          </span>
          <span className="text-[11px] text-muted-foreground/60 truncate">{authorLabel}</span>
          <TimeAgo date={headerDate} className="text-[11px] text-muted-foreground/40 shrink-0" />
        </div>
        {!readOnly && allIds.length > 1 && !hasPending && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground/50 hover:text-muted-foreground h-7 px-2 text-[11px]"
            onClick={handleDismissAll}
          >
            <XMarkIcon className="h-3 w-3 mr-1" />
            Dismiss all
          </Button>
        )}
      </div>

      {/* Original quote */}
      {originalText && (
        <ExpandableQuote
          text={originalText}
          className="border-l-2 border-muted-foreground/20 pl-2.5 italic"
        />
      )}

      {/* Child suggestions */}
      <div className="space-y-2 pl-1">
        {group.suggestions.map((s) =>
          s.suggestionType === 'vote_on_post' ? (
            <VoteOnPostChild
              key={s.id}
              suggestion={s}
              onCreatePost={onCreatePost}
              onResolved={onResolved}
              onStartDismiss={handleStartDismiss}
              onUndo={handleUndo}
              isPendingDismiss={pendingDismissIds.has(s.id)}
              capturedHeight={capturedHeights.get(s.id)}
              readOnly={readOnly}
            />
          ) : (
            <CreatePostChild
              key={s.id}
              suggestion={s}
              onCreatePost={onCreatePost}
              onResolved={onResolved}
              onStartDismiss={handleStartDismiss}
              onUndo={handleUndo}
              isPendingDismiss={pendingDismissIds.has(s.id)}
              capturedHeight={capturedHeights.get(s.id)}
              readOnly={readOnly}
            />
          )
        )}
      </div>
    </div>
  )
}

// ─── Pending dismiss placeholder ────────────────────────────────────

function DismissedPlaceholder({ height, onUndo }: { height?: number; onUndo: () => void }) {
  return (
    <div
      style={height ? { height } : undefined}
      className="flex items-center justify-between rounded-md border border-dashed border-border/40 bg-muted/20 px-4"
    >
      <span className="text-sm text-muted-foreground/60">Dismissed</span>
      <Button size="sm" variant="ghost" onClick={onUndo} className="text-primary">
        Undo
      </Button>
    </div>
  )
}

// ─── Child: Create post ─────────────────────────────────────────────

interface SuggestionChildProps {
  suggestion: SuggestionListItem
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
  onStartDismiss: (id: string, height: number) => void
  onUndo: (id: string) => void
  isPendingDismiss: boolean
  capturedHeight?: number
  readOnly?: boolean
}

function CreatePostChild({
  suggestion,
  onCreatePost,
  onResolved,
  onStartDismiss,
  onUndo,
  isPendingDismiss,
  capturedHeight,
  readOnly,
}: SuggestionChildProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const { restore, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: false,
    onResolved,
  })

  const handleDismiss = useCallback(() => {
    const height = cardRef.current?.offsetHeight ?? 52
    onStartDismiss(suggestion.id, height)
  }, [suggestion.id, onStartDismiss])

  if (isPendingDismiss) {
    return <DismissedPlaceholder height={capturedHeight} onUndo={() => onUndo(suggestion.id)} />
  }

  const actions = readOnly ? (
    <Button size="sm" variant="ghost" onClick={restore} disabled={isPending}>
      Restore
    </Button>
  ) : (
    <div className="flex items-center gap-1.5 shrink-0">
      <Button
        size="sm"
        variant="outline"
        onClick={() => onCreatePost(suggestion)}
        disabled={isPending}
      >
        Create post
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleDismiss}
        disabled={isPending}
        className="text-muted-foreground"
      >
        Dismiss
      </Button>
    </div>
  )

  return (
    <div ref={cardRef}>
      <CompactPostCard
        dashed
        label="Create post"
        title={suggestion.suggestedTitle ?? 'Create post suggestion'}
        voteCount={0}
        boardName={suggestion.board?.name}
        description={suggestion.suggestedBody}
        actions={actions}
      />
    </div>
  )
}

// ─── Child: Vote on post ────────────────────────────────────────────

function VoteOnPostChild({
  suggestion,
  onCreatePost,
  onResolved,
  onStartDismiss,
  onUndo,
  isPendingDismiss,
  capturedHeight,
  readOnly,
}: SuggestionChildProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const targetPost = suggestion.targetPost
  const { accept, restore, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: false,
    onResolved,
  })

  const handleDismiss = useCallback(() => {
    const height = cardRef.current?.offsetHeight ?? 52
    onStartDismiss(suggestion.id, height)
  }, [suggestion.id, onStartDismiss])

  if (isPendingDismiss) {
    return <DismissedPlaceholder height={capturedHeight} onUndo={() => onUndo(suggestion.id)} />
  }

  if (!targetPost) return null

  const similarity = suggestion.similarPosts?.find((p) => p.postId === targetPost?.id)?.similarity
  const similarityLabel = similarity != null ? ` ${Math.round(similarity * 100)}%` : ''

  const actions = readOnly ? (
    <Button size="sm" variant="ghost" onClick={restore} disabled={isPending}>
      Restore
    </Button>
  ) : (
    <div className="flex items-center gap-1.5 shrink-0">
      <Button size="sm" variant="outline" onClick={() => accept(undefined)} disabled={isPending}>
        <HandThumbUpIcon className="h-3.5 w-3.5 mr-1" />
        Vote
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onCreatePost(suggestion)}
        disabled={isPending}
        className="text-muted-foreground"
      >
        Create instead
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleDismiss}
        disabled={isPending}
        className="text-muted-foreground"
      >
        Dismiss
      </Button>
    </div>
  )

  return (
    <div ref={cardRef}>
      <CompactPostCard
        label={`Vote on post${similarityLabel}`}
        title={targetPost.title}
        voteCount={targetPost.voteCount}
        boardName={targetPost.boardName}
        statusName={targetPost.statusName}
        statusColor={targetPost.statusColor}
        description={undefined}
        actions={actions}
      />
    </div>
  )
}
