'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightIcon,
  CheckIcon,
  XMarkIcon,
  ChatBubbleLeftIcon,
  HandThumbUpIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SourceTypeIcon } from '../source-type-icon'
import { acceptSuggestionFn, dismissSuggestionFn } from '@/lib/server/functions/feedback'
import { cn } from '@/lib/shared/utils'
import type { SuggestionListItem } from '../feedback-types'

interface SuggestionDetailProps {
  suggestion: SuggestionListItem
  onAccepted?: () => void
  onDismissed?: () => void
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function SuggestionDetail({ suggestion, onAccepted, onDismissed }: SuggestionDetailProps) {
  const queryClient = useQueryClient()
  const isMerge = suggestion.suggestionType === 'merge_post'
  const rawItem = suggestion.rawItem
  const content = rawItem?.content
  const author = rawItem?.author

  // Editable fields for create_post suggestions
  const [editTitle, setEditTitle] = useState(suggestion.suggestedTitle ?? '')
  const [editBody, setEditBody] = useState(suggestion.suggestedBody ?? '')

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['feedback', 'suggestions'] })
    queryClient.invalidateQueries({ queryKey: ['feedback', 'suggestionStats'] })
  }

  const acceptMutation = useMutation({
    mutationFn: () =>
      acceptSuggestionFn({
        data: {
          id: suggestion.id,
          ...(!isMerge && { edits: { title: editTitle, body: editBody } }),
        },
      }),
    onSuccess: () => {
      invalidate()
      onAccepted?.()
    },
  })

  const dismissMutation = useMutation({
    mutationFn: () => dismissSuggestionFn({ data: { id: suggestion.id } }),
    onSuccess: () => {
      invalidate()
      onDismissed?.()
    },
  })

  const isPending = acceptMutation.isPending || dismissMutation.isPending

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <Badge
            variant="outline"
            className={cn(
              'text-[11px] font-semibold tracking-wide uppercase',
              isMerge
                ? 'border-blue-300/50 text-blue-600 dark:border-blue-700/50 dark:text-blue-400'
                : 'border-emerald-300/50 text-emerald-600 dark:border-emerald-700/50 dark:text-emerald-400'
            )}
          >
            {isMerge ? 'Merge Post Suggestion' : 'New Post Suggestion'}
          </Badge>
        </div>

        {/* Source Feedback Card */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
            Source Feedback
          </h4>
          <div className="rounded-lg border border-border/40 bg-muted/20 p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <SourceTypeIcon sourceType={rawItem?.sourceType ?? 'api'} size="sm" />
              <div className="min-w-0">
                <span className="text-xs font-medium text-foreground">
                  {rawItem?.source?.name ?? rawItem?.sourceType ?? 'Unknown source'}
                </span>
                {rawItem?.sourceCreatedAt && (
                  <span className="text-[10px] text-muted-foreground/50 ml-2">
                    {formatDate(rawItem.sourceCreatedAt)}
                  </span>
                )}
              </div>
            </div>

            {content?.subject && (
              <p className="text-sm font-medium text-foreground mb-1.5 leading-snug">
                {content.subject}
              </p>
            )}

            {content?.text && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-6">
                {content.text}
              </p>
            )}

            {(author?.email || author?.name) && (
              <div className="mt-3 pt-2.5 border-t border-border/30">
                <span className="text-[11px] text-muted-foreground/60">
                  {author.name ?? author.email}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Merge Target or Suggested Post */}
        {isMerge && suggestion.targetPost && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
              Merge Into
            </h4>
            <div className="rounded-lg border border-blue-200/50 dark:border-blue-800/30 bg-blue-50/30 dark:bg-blue-950/20 p-4">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-100/80 dark:bg-blue-900/40 shrink-0">
                  <ArrowRightIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">
                    {suggestion.targetPost.title}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/70">
                    <span className="flex items-center gap-1">
                      <HandThumbUpIcon className="h-3 w-3" />
                      {suggestion.targetPost.voteCount} votes
                    </span>
                    <Badge variant="subtle" className="text-[10px] px-1.5 py-0 capitalize">
                      {suggestion.targetPost.status?.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                </div>
              </div>

              {suggestion.similarityScore != null && (
                <div className="mt-3 pt-2.5 border-t border-blue-200/30 dark:border-blue-800/20">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground/60">Similarity</span>
                    <span className="text-sm font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                      {Math.round(suggestion.similarityScore * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-blue-100 dark:bg-blue-900/40 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500/80 transition-all duration-500"
                      style={{ width: `${Math.round(suggestion.similarityScore * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!isMerge && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
              Suggested Post
            </h4>
            <div className="rounded-lg border border-emerald-200/50 dark:border-emerald-800/30 bg-emerald-50/30 dark:bg-emerald-950/20 p-4 space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1 block">
                  Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-transparent border-0 border-b border-border/30 focus:border-emerald-500/50 outline-none text-sm font-medium text-foreground pb-1.5 transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1 block">
                  Body
                </label>
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={4}
                  className="w-full bg-transparent border-0 border-b border-border/30 focus:border-emerald-500/50 outline-none text-sm text-foreground resize-none leading-relaxed pb-1.5 transition-colors"
                />
              </div>
              {suggestion.board && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                    Board
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {suggestion.board.name}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Signal */}
        {suggestion.signal && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
              Extracted Signal
            </h4>
            <div className="rounded-lg border border-border/40 bg-card p-4">
              <p className="text-sm text-foreground leading-relaxed">{suggestion.signal.summary}</p>
              <div className="flex items-center gap-3 mt-2.5 text-xs text-muted-foreground/60">
                <Badge variant="subtle" className="text-[10px] px-1.5 py-0 capitalize">
                  {suggestion.signal.signalType?.replace(/_/g, ' ')}
                </Badge>
                <span className="tabular-nums">
                  {Math.round(suggestion.signal.extractionConfidence * 100)}% confidence
                </span>
              </div>
            </div>
          </div>
        )}

        {/* AI Reasoning */}
        {suggestion.reasoning && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
              AI Reasoning
            </h4>
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/30">
              <ChatBubbleLeftIcon className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                {suggestion.reasoning}
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={() => acceptMutation.mutate()}
            disabled={isPending}
            className="flex-1"
            size="sm"
          >
            <CheckIcon className="h-4 w-4 mr-1.5" />
            {isMerge ? 'Accept Merge' : 'Create Post'}
          </Button>
          <Button
            variant="outline"
            onClick={() => dismissMutation.mutate()}
            disabled={isPending}
            className="flex-1"
            size="sm"
          >
            <XMarkIcon className="h-4 w-4 mr-1.5" />
            Dismiss
          </Button>
        </div>

        {/* Accept hint */}
        <p className="text-[10px] text-muted-foreground/40 text-center leading-relaxed">
          {isMerge
            ? 'Accepting adds a vote to the target post and links this feedback.'
            : 'Creates a new post on the selected board with the title and body above.'}
        </p>
      </div>
    </ScrollArea>
  )
}
