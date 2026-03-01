'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState } from 'react'
import { SparklesIcon, ArrowRightIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
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
      <div className="mx-6 mt-4 space-y-2">
        {suggestions.map((suggestion) => {
          // Show the "other" post (not the one being viewed)
          const otherPostTitle =
            suggestion.sourcePostId === postId
              ? suggestion.targetPostTitle
              : suggestion.sourcePostTitle
          const confidence = Math.round((suggestion.llmConfidence as number) * 100)

          return (
            <div
              key={suggestion.id}
              className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800/40"
            >
              <div className="flex items-start gap-2">
                <SparklesIcon className="h-4 w-4 mt-0.5 text-violet-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-violet-800 dark:text-violet-200">
                    AI detected a possible duplicate ({confidence}% confidence):{' '}
                    <span className="font-medium">{otherPostTitle}</span>
                  </p>
                  {suggestion.llmReasoning && (
                    <p className="text-xs text-violet-600 dark:text-violet-400 mt-1">
                      {suggestion.llmReasoning}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmAccept(suggestion as Suggestion)}
                      disabled={loading}
                      className="text-xs h-7 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                    >
                      Merge
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDismiss(suggestion.id as string)}
                      disabled={loading}
                      className="text-xs h-7 text-violet-600 dark:text-violet-400"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            </div>
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
