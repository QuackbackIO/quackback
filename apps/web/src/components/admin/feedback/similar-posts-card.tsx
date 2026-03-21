'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  SparklesIcon,
  ChevronDownIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { IconGitMerge } from '@tabler/icons-react'
import { CompactPostCard } from '@/components/shared/compact-post-card'
import { cn } from '@/lib/shared/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { mergeSuggestionQueries } from '@/lib/client/queries/signals'
import { acceptSuggestionFn, dismissSuggestionFn } from '@/lib/server/functions/feedback'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import type { PostId } from '@quackback/ids'

interface SimilarPostsCardProps {
  postId: PostId
  onNavigateToPost?: (postId: string) => void
}

export function SimilarPostsCard({ postId, onNavigateToPost }: SimilarPostsCardProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: suggestions } = useQuery(mergeSuggestionQueries.forPost(postId))

  if (!suggestions || suggestions.length === 0) return null

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['merge-suggestions'] })
    queryClient.invalidateQueries({ queryKey: ['merged-posts'] })
    queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
    queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
  }

  const handleAccept = async (suggestionId: string, swapDirection: boolean) => {
    setPendingId(suggestionId)
    try {
      await acceptSuggestionFn({ data: { id: suggestionId, swapDirection } })
      toast.success('Posts merged')
      invalidateAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge')
    } finally {
      setPendingId(null)
    }
  }

  const handleDismiss = async (suggestionId: string) => {
    setPendingId(suggestionId)
    try {
      await dismissSuggestionFn({ data: { id: suggestionId } })
      toast.success('Suggestion dismissed')
      invalidateAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border border-border/30 rounded-lg bg-muted/5">
        {/* Header */}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/10 transition-colors rounded-t-lg"
          >
            <SparklesIcon className="size-3.5 text-amber-500/80 shrink-0" />
            <p className="text-xs font-medium text-muted-foreground/70">Similar Posts</p>
            <span className="text-xs tabular-nums text-muted-foreground/50 font-medium">
              {suggestions.length}
            </span>
            <div className="flex-1" />
            <ChevronDownIcon
              className={cn(
                'size-3.5 text-muted-foreground transition-transform duration-200',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>

        {/* Body */}
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="divide-y divide-border/20">
            {suggestions.map((suggestion) => {
              const isSource = suggestion.sourcePostId === postId
              const otherPostId = isSource ? suggestion.targetPostId : suggestion.sourcePostId
              const otherTitle = isSource ? suggestion.targetPostTitle : suggestion.sourcePostTitle
              const otherVoteCount = isSource
                ? suggestion.targetPostVoteCount
                : suggestion.sourcePostVoteCount
              const otherStatusName = isSource
                ? suggestion.targetPostStatusName
                : suggestion.sourcePostStatusName
              const otherStatusColor = isSource
                ? suggestion.targetPostStatusColor
                : suggestion.sourcePostStatusColor
              const isPending = pendingId === suggestion.id

              const actions = (
                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip>
                    <DropdownMenu>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                            disabled={isPending}
                          >
                            <IconGitMerge className="size-4" strokeWidth={1.5} />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Merge</TooltipContent>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => handleAccept(suggestion.id, isSource)}>
                          <ArrowDownIcon className="size-4 mr-2" />
                          Merge into this
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleAccept(suggestion.id, !isSource)}>
                          <ArrowUpIcon className="size-4 mr-2" />
                          Merge into that
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                        disabled={isPending}
                        onClick={() => handleDismiss(suggestion.id)}
                      >
                        <XMarkIcon className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Dismiss</TooltipContent>
                  </Tooltip>
                </div>
              )

              return (
                <div key={suggestion.id} className="px-5 py-2.5 group">
                  <CompactPostCard
                    title={otherTitle}
                    voteCount={otherVoteCount}
                    statusName={otherStatusName}
                    statusColor={otherStatusColor}
                    description={suggestion.llmReasoning}
                    onClick={() => onNavigateToPost?.(otherPostId)}
                    actions={actions}
                    className="border-0 bg-transparent p-2"
                  />
                </div>
              )
            })}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
