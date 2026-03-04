import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowPathIcon,
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  ChevronUpIcon,
  Squares2X2Icon,
  SparklesIcon,
} from '@heroicons/react/24/solid'
import { ArrowRightIcon } from '@heroicons/react/16/solid'
import { ChatBubbleLeftIcon as CommentIcon } from '@heroicons/react/24/outline'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import { SourceTypeIcon } from '../source-type-icon'
import { useSuggestionActions } from './use-suggestion-actions'
import { useUnmergePost } from '@/lib/client/mutations/post-merge'
import { suggestionsKeys } from '@/lib/client/hooks/use-suggestions-query'
import { acceptSuggestionFn, dismissSuggestionFn } from '@/lib/server/functions/feedback'
import { MergeConfirmDialog } from './merge-confirm-dialog'
import { computeMergePreview } from './merge-preview'
import type { SuggestionListItem } from '../feedback-types'
import type { PostId } from '@quackback/ids'

interface SuggestionTriageRowProps {
  suggestion: SuggestionListItem
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
}

export function SuggestionTriageRow({
  suggestion,
  onCreatePost,
  onResolved,
}: SuggestionTriageRowProps) {
  const isDuplicate = suggestion.suggestionType === 'duplicate_post'

  if (isDuplicate) {
    return <DuplicateRow suggestion={suggestion} onResolved={onResolved} />
  }

  return (
    <CreatePostRow suggestion={suggestion} onCreatePost={onCreatePost} onResolved={onResolved} />
  )
}

// ─── Duplicate post: stacked cards → merged preview ─────────────────

interface MergedState {
  canonicalPost: NonNullable<SuggestionListItem['targetPost']> | NonNullable<SuggestionListItem['sourcePost']>
  duplicatePostId: string
}

function DuplicateRow({
  suggestion,
  onResolved,
}: {
  suggestion: SuggestionListItem
  onResolved: () => void
}) {
  const [swapped, setSwapped] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [mergedState, setMergedState] = useState<MergedState | null>(null)

  const queryClient = useQueryClient()

  // Direct merge mutation — sets local merged state without invalidating queries
  const mergeMutation = useMutation({
    mutationFn: (opts?: { swapDirection: boolean }) =>
      acceptSuggestionFn({
        data: {
          id: suggestion.id,
          ...(opts?.swapDirection && { swapDirection: true }),
        },
      }),
    onSuccess: (_data, variables) => {
      const wasSwapped = variables?.swapDirection ?? false
      const canonical = wasSwapped ? suggestion.sourcePost : suggestion.targetPost
      const duplicate = wasSwapped ? suggestion.targetPost : suggestion.sourcePost
      if (canonical && duplicate) {
        setMergedState({ canonicalPost: canonical, duplicatePostId: duplicate.id })
      }
    },
  })

  // Dismiss mutation — same behavior as useSuggestionActions
  const dismissMutation = useMutation({
    mutationFn: () => dismissSuggestionFn({ data: { id: suggestion.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: suggestionsKeys.all })
      onResolved()
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: suggestionsKeys.all })
    },
  })

  const isPending = mergeMutation.isPending || dismissMutation.isPending

  const duplicatePost = swapped ? suggestion.targetPost : suggestion.sourcePost
  const canonicalPost = swapped ? suggestion.sourcePost : suggestion.targetPost

  const preview = useMemo(() => {
    if (!duplicatePost || !canonicalPost) return null
    return computeMergePreview(duplicatePost, canonicalPost)
  }, [duplicatePost, canonicalPost])

  // ─── Resolved state: show merged confirmation ───
  if (mergedState) {
    return (
      <MergedDuplicateRow
        mergedState={mergedState}
        onDismiss={() => {
          queryClient.invalidateQueries({ queryKey: suggestionsKeys.all })
          onResolved()
        }}
      />
    )
  }

  return (
    <div className="w-full px-4 py-3 space-y-2.5">
      {/* Header: sparkles + label + time */}
      <div className="flex items-center gap-2">
        <SparklesIcon className="h-3.5 w-3.5 text-amber-500/80 shrink-0" />
        <span className="text-xs font-medium text-muted-foreground/70">Possible duplicate</span>
        <div className="flex-1" />
        <TimeAgo
          date={suggestion.createdAt}
          className="text-[11px] text-muted-foreground/40 shrink-0"
        />
      </div>

      {/* AI reasoning */}
      {suggestion.reasoning && (
        <p className="text-sm text-foreground/80 leading-relaxed line-clamp-3">
          {suggestion.reasoning}
        </p>
      )}

      {/* Stacked source cards → merged preview */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* Left: stacked post cards with swap */}
        <div className="flex flex-col gap-1.5">
          <MiniPostCard post={canonicalPost} />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setSwapped(!swapped)}
              className={cn(
                'flex items-center px-1.5 py-0.5 rounded transition-colors cursor-pointer',
                'hover:bg-muted/60 text-muted-foreground/40 hover:text-muted-foreground/70',
                swapped &&
                  'text-violet-500 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-300'
              )}
              title="Swap merge direction"
            >
              <ArrowPathIcon className="h-3.5 w-3.5 rotate-90" />
            </button>
          </div>
          <MiniPostCard post={duplicatePost} label="Duplicate" />
        </div>

        {/* Center: arrow */}
        <div className="hidden md:flex items-center justify-center px-1">
          <ArrowRightIcon className="h-4 w-4 text-muted-foreground/40" />
        </div>

        {/* Right: merged preview card */}
        {preview && (
          <MergePreviewCard
            preview={preview}
            onClick={() => setShowConfirmDialog(true)}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowConfirmDialog(true)}
          disabled={isPending}
        >
          Merge
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => dismissMutation.mutate()}
          disabled={isPending}
          className="text-muted-foreground"
        >
          Dismiss
        </Button>
      </div>

      {/* Merge confirmation dialog */}
      {duplicatePost && canonicalPost && preview && (
        <MergeConfirmDialog
          open={showConfirmDialog}
          onOpenChange={setShowConfirmDialog}
          duplicatePost={duplicatePost}
          canonicalPost={canonicalPost}
          preview={preview}
          onConfirm={() => mergeMutation.mutate(swapped ? { swapDirection: true } : undefined)}
          isPending={isPending}
        />
      )}
    </div>
  )
}

// ─── Merged confirmation row ────────────────────────────────────────

function MergedDuplicateRow({
  mergedState,
  onDismiss,
}: {
  mergedState: MergedState
  onDismiss: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const unmerge = useUnmergePost()

  const handleUndo = async () => {
    await unmerge.mutateAsync(mergedState.duplicatePostId as PostId)
    queryClient.invalidateQueries({ queryKey: suggestionsKeys.all })
    onDismiss()
  }

  return (
    <div className="w-full px-4 py-3 space-y-2.5 border-l-2 border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-950/10">
      {/* Header with dismiss button */}
      <div className="flex items-center gap-2">
        <CheckCircleIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
          Posts merged
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDismiss}
          className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer"
          title="Dismiss"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Canonical post card */}
      <MiniPostCard post={mergedState.canonicalPost} />

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({
              to: '/admin/feedback/insights',
              search: (prev: Record<string, unknown>) => ({
                ...prev,
                post: mergedState.canonicalPost.id,
              }),
            })
          }
        >
          View post
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleUndo}
          disabled={unmerge.isPending}
          className="text-muted-foreground"
        >
          Undo merge
        </Button>
      </div>
    </div>
  )
}

// ─── Merge preview card ─────────────────────────────────────────────

function MergePreviewCard({
  preview,
  onClick,
}: {
  preview: ReturnType<typeof computeMergePreview>
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 rounded-md border border-dashed border-border/60 bg-muted/20 p-2.5 text-left cursor-pointer transition-colors hover:bg-muted/40 hover:border-border group"
    >
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
          Merged result
        </p>
        <span className="text-[10px] text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity">
          Review
        </span>
      </div>
      <div className="flex items-start gap-2.5">
        {/* Vote pill */}
        <div className="flex flex-col items-center shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-1 gap-0">
          <ChevronUpIcon className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {preview.voteCount}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {preview.statusName && (
            <div className="flex items-center mb-0.5">
              <StatusBadge
                name={preview.statusName}
                color={preview.statusColor}
                className="text-[10px]"
              />
            </div>
          )}
          <p className="text-sm font-semibold text-foreground line-clamp-1">{preview.title}</p>
          {preview.content && (
            <p className="text-xs text-muted-foreground/60 line-clamp-1 mt-0.5">{preview.content}</p>
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 mt-1.5">
            {preview.boardName && (
              <>
                <Squares2X2Icon className="h-3 w-3 shrink-0 text-muted-foreground/40 -mr-1 mb-0.5" />
                <span className="truncate">{preview.boardName}</span>
              </>
            )}
            <span className="flex items-center gap-0.5 ml-auto shrink-0">
              <CommentIcon className="h-3 w-3" />
              {preview.commentCount}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Mini post card ─────────────────────────────────────────────────

/** Compact post card matching the real PostCard layout — clickable to open post modal. */
function MiniPostCard({
  post,
  label,
}: {
  post: SuggestionListItem['sourcePost'] | SuggestionListItem['targetPost']
  label?: string
}) {
  const navigate = useNavigate()

  if (!post) return <div className="min-w-0" />

  const handleClick = () => {
    navigate({
      to: '/admin/feedback/insights',
      search: (prev: Record<string, unknown>) => ({ ...prev, post: post.id }),
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="min-w-0 rounded-md border border-border/60 bg-muted/30 p-2.5 text-left cursor-pointer transition-colors hover:bg-muted/50 hover:border-border"
    >
      <div className="flex items-start gap-2.5">
        {/* Vote pill */}
        <div className="flex flex-col items-center shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-1 gap-0">
          <ChevronUpIcon className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {post.voteCount}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {(label || post.statusName) && (
          <div className="flex items-center gap-1.5 mb-0.5">
            {label && (
              <span className="text-[10px] font-medium px-1.5 py-0 rounded-sm bg-muted text-muted-foreground/70">
                {label}
              </span>
            )}
            {post.statusName && (
              <StatusBadge
                name={post.statusName}
                color={post.statusColor}
                className="text-[10px]"
              />
            )}
          </div>
          )}
          <p className="text-sm font-semibold text-foreground line-clamp-1">{post.title}</p>
          {post.content && (
            <p className="text-xs text-muted-foreground/60 line-clamp-1 mt-0.5">{post.content}</p>
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 mt-1.5">
            {post.boardName && (
              <>
                <Squares2X2Icon className="h-3 w-3 shrink-0 text-muted-foreground/40 -mr-1 mb-0.5" />
                <span className="truncate">{post.boardName}</span>
              </>
            )}
            {post.createdAt && (
              <>
                {post.boardName && <span className="text-muted-foreground/30">&middot;</span>}
                <TimeAgo date={post.createdAt} className="shrink-0" />
              </>
            )}
            {(post.commentCount ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 ml-auto shrink-0">
                <CommentIcon className="h-3 w-3" />
                {post.commentCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Create post: original layout ─────────────────────────────────────

function CreatePostRow({
  suggestion,
  onCreatePost,
  onResolved,
}: {
  suggestion: SuggestionListItem
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
}) {
  const rawItem = suggestion.rawItem
  const content = rawItem?.content
  const author = rawItem?.author
  const sourceType = rawItem?.sourceType ?? 'api'
  const originalText = content?.text ?? ''

  const { dismiss, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: false,
    onResolved,
  })

  return (
    <div className="w-full px-4 py-3 space-y-2.5">
      {/* Header: source icon + type badge + author + time */}
      <div className="flex items-center gap-2">
        <SourceTypeIcon sourceType={sourceType} size="sm" />
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 shrink-0 border-emerald-300/50 text-emerald-600 dark:border-emerald-700/50 dark:text-emerald-400"
        >
          Create post
        </Badge>
        <span className="text-[11px] text-muted-foreground/60 truncate">
          {author?.name ?? author?.email ?? rawItem?.source?.name ?? sourceType}
        </span>
        <TimeAgo
          date={suggestion.createdAt}
          className="text-[11px] text-muted-foreground/40 shrink-0"
        />
      </div>

      {/* Original feedback quote */}
      {originalText && (
        <p className="text-xs text-muted-foreground/70 line-clamp-2 border-l-2 border-muted-foreground/20 pl-2.5 italic">
          {originalText}
        </p>
      )}

      {/* AI-derived title + reasoning */}
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground leading-snug">
          {suggestion.suggestedTitle ?? 'Create post suggestion'}
        </p>
        {suggestion.reasoning && (
          <p className="text-[11px] text-muted-foreground/50 line-clamp-1 flex items-center gap-1.5 mt-1">
            <ChatBubbleLeftIcon className="h-3 w-3 shrink-0" />
            {suggestion.reasoning}
          </p>
        )}
      </div>

      {/* Footer: board + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          {suggestion.board && (
            <Badge variant="outline" className="text-[10px] inline-flex items-center gap-0.5">
              <Squares2X2Icon className="h-3 w-3 text-muted-foreground/40" />
              {suggestion.board.name}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
            onClick={() => dismiss()}
            disabled={isPending}
            className="text-muted-foreground"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  )
}
