'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  SparklesIcon,
  ChevronUpIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { cn } from '@/lib/shared/utils'
import { signalQueries } from '@/lib/client/queries/signals'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { suggestionsKeys } from '@/lib/client/hooks/use-suggestions-query'
import { acceptSuggestionFn, dismissSuggestionFn } from '@/lib/server/functions/feedback'
import { MergePreviewModal } from '@/components/admin/feedback/suggestions/merge-preview-modal'
import { MergeConfirmDialog } from '@/components/admin/feedback/suggestions/merge-confirm-dialog'
import type { MergePreview } from '@/components/admin/feedback/suggestions/merge-preview'
import type { AiSignalRow } from '@/lib/server/domains/signals'
import type { PostId } from '@quackback/ids'

interface DuplicateSignalCardProps {
  signal: AiSignalRow
  postId: PostId
}

/**
 * Actionable duplicate triage card for the post modal.
 *
 * Fetches the merge suggestion that generated this signal,
 * shows the matched post, AI reasoning, and offers merge/dismiss/preview.
 */
export function DuplicateSignalCard({ signal, postId }: DuplicateSignalCardProps) {
  const queryClient = useQueryClient()
  const matchedPostId = signal.payload.matchedPostId as string | undefined
  const confidence = signal.payload.confidence as number | undefined

  const { data: suggestions } = useQuery(signalQueries.mergeSuggestionsForPost(postId))

  // Find the suggestion that matches this signal's matched post
  const suggestion = useMemo(() => {
    if (!suggestions || !matchedPostId) return null
    return suggestions.find(
      (s) => s.sourcePostId === matchedPostId || s.targetPostId === matchedPostId
    ) ?? null
  }, [suggestions, matchedPostId])

  const [swapped, setSwapped] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Determine which post is "the other one" to display
  const otherPost = useMemo(() => {
    if (!suggestion) return null
    // The signal is on this post; show the other post in the suggestion pair
    const isSource = suggestion.sourcePostId === postId
    return {
      id: isSource ? suggestion.targetPostId : suggestion.sourcePostId,
      title: isSource ? suggestion.targetPostTitle : suggestion.sourcePostTitle,
      voteCount: isSource ? suggestion.targetPostVoteCount : suggestion.sourcePostVoteCount,
      statusName: isSource ? suggestion.targetPostStatusName : suggestion.sourcePostStatusName,
      statusColor: isSource ? suggestion.targetPostStatusColor : suggestion.sourcePostStatusColor,
    }
  }, [suggestion, postId])

  // For merge direction: canonical = the one kept, duplicate = merged away
  // Default: suggestion.targetPostId is canonical (higher votes)
  // Swapped: flip the direction
  const canonicalId = suggestion
    ? (swapped ? suggestion.sourcePostId : suggestion.targetPostId) as PostId
    : null
  const duplicateId = suggestion
    ? (swapped ? suggestion.targetPostId : suggestion.sourcePostId) as PostId
    : null

  // Build MergePreview for confirmation dialog
  const preview = useMemo((): MergePreview | null => {
    if (!suggestion) return null
    // Canonical post details (the one that survives)
    const canon = swapped
      ? { title: suggestion.sourcePostTitle, votes: suggestion.sourcePostVoteCount, statusName: suggestion.sourcePostStatusName, statusColor: suggestion.sourcePostStatusColor }
      : { title: suggestion.targetPostTitle, votes: suggestion.targetPostVoteCount, statusName: suggestion.targetPostStatusName, statusColor: suggestion.targetPostStatusColor }
    const dup = swapped
      ? { votes: suggestion.targetPostVoteCount }
      : { votes: suggestion.sourcePostVoteCount }

    return {
      title: canon.title,
      content: null,
      voteCount: canon.votes + dup.votes,
      commentCount: 0,
      boardName: null,
      statusName: canon.statusName,
      statusColor: canon.statusColor,
    }
  }, [suggestion, swapped])

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['signals'] })
    queryClient.invalidateQueries({ queryKey: suggestionsKeys.all })
    queryClient.invalidateQueries({ queryKey: inboxKeys.all })
  }

  const mergeMutation = useMutation({
    mutationFn: () =>
      acceptSuggestionFn({
        data: {
          id: suggestion!.id,
          ...(swapped && { swapDirection: true }),
        },
      }),
    onSuccess: () => {
      toast.success('Posts merged')
      invalidateAll()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to merge')
    },
  })

  const dismissMutation = useMutation({
    mutationFn: () =>
      dismissSuggestionFn({ data: { id: suggestion!.id } }),
    onSuccess: () => {
      toast.success('Suggestion dismissed')
      invalidateAll()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss')
    },
  })

  const isPending = mergeMutation.isPending || dismissMutation.isPending

  // If no suggestion found (resolved separately or signal exists without suggestion), show minimal info
  if (!suggestion || !otherPost) {
    if (!matchedPostId) return null
    const pct = confidence ? `${Math.round(confidence * 100)}%` : null
    return (
      <div className="text-sm text-muted-foreground">
        <span className="text-amber-400 font-medium">Possible duplicate</span>
        {pct && <span className="ml-1.5 text-muted-foreground/60">({pct} match)</span>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header with confidence */}
      <div className="flex items-center gap-2">
        <SparklesIcon className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="text-xs font-medium text-amber-400">Possible duplicate</span>
        {confidence && (
          <span className="text-xs text-muted-foreground/60">
            {Math.round(confidence * 100)}% match
          </span>
        )}
      </div>

      {/* AI reasoning */}
      {suggestion.llmReasoning && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {suggestion.llmReasoning}
        </p>
      )}

      {/* Matched post card */}
      <div className="rounded-md border border-border/60 bg-muted/30 p-2.5">
        <div className="flex items-start gap-2.5">
          {/* Vote pill */}
          <div className="flex flex-col items-center shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-1">
            <ChevronUpIcon className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {otherPost.voteCount}
            </span>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {otherPost.statusName && (
              <div className="mb-0.5">
                <StatusBadge
                  name={otherPost.statusName}
                  color={otherPost.statusColor}
                  className="text-[10px]"
                />
              </div>
            )}
            <p className="text-sm font-semibold text-foreground line-clamp-1">
              {otherPost.title}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowPreview(true)}
          disabled={isPending}
          className="text-xs"
        >
          Preview
        </Button>

        <div className="flex items-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowConfirm(true)}
            disabled={isPending}
            className="text-xs rounded-r-none border-r-0"
          >
            {mergeMutation.isPending ? 'Merging...' : 'Merge'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSwapped(!swapped)}
            disabled={isPending}
            className={cn(
              'px-1.5 rounded-l-none text-xs',
              swapped && 'text-violet-500 dark:text-violet-400'
            )}
            title={swapped ? 'Direction swapped — click to reset' : 'Swap merge direction'}
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => dismissMutation.mutate()}
          disabled={isPending}
          className="text-xs text-muted-foreground"
        >
          {dismissMutation.isPending ? 'Dismissing...' : 'Not a duplicate'}
        </Button>
      </div>

      {/* Merge preview modal */}
      {canonicalId && duplicateId && (
        <MergePreviewModal
          open={showPreview}
          onOpenChange={setShowPreview}
          canonicalPostId={canonicalId}
          duplicatePostId={duplicateId}
        />
      )}

      {/* Merge confirmation dialog */}
      {preview && (
        <MergeConfirmDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          preview={preview}
          onConfirm={() => mergeMutation.mutate()}
          isPending={isPending}
        />
      )}
    </div>
  )
}
