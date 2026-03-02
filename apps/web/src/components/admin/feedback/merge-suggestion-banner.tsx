'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState } from 'react'
import { SparklesIcon, ArrowRightIcon } from '@heroicons/react/16/solid'
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  getMergeSuggestionsForPostFn,
  acceptMergeSuggestionFn,
  dismissMergeSuggestionFn,
} from '@/lib/server/functions/merge-suggestions'
import type { PostId } from '@quackback/ids'

interface MergeSuggestionBannerProps {
  postId: PostId
}

interface Suggestion {
  id: string
  sourcePostId: string
  targetPostId: string
  sourcePostTitle: string
  targetPostTitle: string
  sourcePostVoteCount: number
  targetPostVoteCount: number
  sourcePostStatusName: string | null
  sourcePostStatusColor: string | null
  targetPostStatusName: string | null
  targetPostStatusColor: string | null
  hybridScore: number
  llmConfidence: number
  llmReasoning: string | null
}

export function MergeSuggestionBanner({ postId }: MergeSuggestionBannerProps) {
  const queryClient = useQueryClient()
  const [confirmAccept, setConfirmAccept] = useState<Suggestion | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: suggestions } = useQuery({
    queryKey: ['merge-suggestions', postId],
    queryFn: () => getMergeSuggestionsForPostFn({ data: { postId } }),
    staleTime: 60_000,
  })

  if (!suggestions || suggestions.length === 0) return null

  const handleAccept = async (suggestion: Suggestion) => {
    setLoading(true)
    try {
      await acceptMergeSuggestionFn({ data: { suggestionId: suggestion.id } })
      queryClient.invalidateQueries({ queryKey: ['merge-suggestions'] })
      queryClient.invalidateQueries({ queryKey: ['merged-posts'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'inbox'] })
      toast.success('Posts merged successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge posts')
    } finally {
      setLoading(false)
      setConfirmAccept(null)
    }
  }

  const handleDismiss = async (suggestionId: string) => {
    try {
      await dismissMergeSuggestionFn({ data: { suggestionId } })
      queryClient.invalidateQueries({ queryKey: ['merge-suggestions', postId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss suggestion')
    }
  }

  return (
    <>
      <div className="space-y-2">
        {suggestions.map((suggestion) => {
          // Show the "other" post (not the one being viewed)
          const isSource = suggestion.sourcePostId === postId
          const otherPostId = isSource ? suggestion.targetPostId : suggestion.sourcePostId
          const otherPost = {
            id: otherPostId,
            title: isSource ? suggestion.targetPostTitle : suggestion.sourcePostTitle,
            voteCount: isSource ? suggestion.targetPostVoteCount : suggestion.sourcePostVoteCount,
            statusName: isSource
              ? suggestion.targetPostStatusName
              : suggestion.sourcePostStatusName,
            statusColor: isSource
              ? suggestion.targetPostStatusColor
              : suggestion.sourcePostStatusColor,
          }
          return (
            <Collapsible key={suggestion.id} defaultOpen>
              <div className="rounded-lg border border-border/30 bg-muted/5 overflow-hidden">
                {/* Header */}
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'group flex w-full items-center gap-2 px-4 py-3 text-left',
                      'hover:bg-muted/10 transition-colors'
                    )}
                  >
                    <SparklesIcon className="h-3.5 w-3.5 text-amber-500/80 shrink-0" />
                    <p className="text-xs font-medium text-muted-foreground/70">
                      Possible duplicate
                    </p>
                    <div className="flex-1" />
                    <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>

                {/* Body */}
                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                  <div className="px-4 pb-3 space-y-2.5">
                    {/* Reasoning */}
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {suggestion.llmReasoning ??
                        'This post may be a duplicate of the following feedback'}
                    </p>

                    {/* Post card */}
                    <a
                      href={`/admin/feedback?post=${otherPost.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 rounded-md border border-border/50 bg-muted/20 p-2 pl-2.5 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex flex-col items-center shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 gap-0">
                        <ChevronUpIcon className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs font-semibold tabular-nums text-foreground">
                          {otherPost.voteCount}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        {otherPost.statusName && (
                          <StatusBadge
                            name={otherPost.statusName}
                            color={otherPost.statusColor}
                            className="text-[10px]"
                          />
                        )}
                        <p className="text-sm font-medium text-foreground truncate">
                          {otherPost.title}
                        </p>
                      </div>
                    </a>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmAccept(suggestion as Suggestion)}
                        disabled={loading}
                        className="text-xs h-7"
                      >
                        Merge into this post
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDismiss(suggestion.id as string)}
                        disabled={loading}
                        className="text-xs h-7 text-muted-foreground"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )
        })}
      </div>

      <AlertDialog open={!!confirmAccept} onOpenChange={(o) => !o && setConfirmAccept(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge these posts?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>The smaller post will be merged into the larger one. Votes will be combined.</p>
                {confirmAccept && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                    <span className="truncate font-medium text-foreground">
                      {confirmAccept.sourcePostTitle}
                    </span>
                    <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">
                      {confirmAccept.targetPostTitle}
                    </span>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAccept && handleAccept(confirmAccept)}
              disabled={loading}
            >
              {loading ? 'Merging...' : 'Merge'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
