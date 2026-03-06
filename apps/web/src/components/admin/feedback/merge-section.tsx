'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRightIcon } from '@heroicons/react/16/solid'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { StatusBadge } from '@/components/ui/status-badge'
import { useMergePost } from '@/lib/client/mutations/post-merge'
import { findSimilarPostsFn, type SimilarPost } from '@/lib/server/functions/public-posts'
import { mergeSuggestionQueries } from '@/lib/client/queries/signals'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import type { PostId } from '@quackback/ids'

// ============================================================================
// Merge Into Dialog (shown when admin wants to merge current post into another)
// ============================================================================

interface MergeIntoDialogProps {
  postId: PostId
  postTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MergeIntoDialog({ postId, postTitle, open, onOpenChange }: MergeIntoDialogProps) {
  const [searchQuery, setSearchQuery] = useState(postTitle)
  const [confirmTarget, setConfirmTarget] = useState<SimilarPost | null>(null)
  const [mergingId, setMergingId] = useState<string | null>(null)
  const merge = useMergePost()
  const queryClient = useQueryClient()

  // Reset search when dialog opens with current post title
  useEffect(() => {
    if (open) {
      setSearchQuery(postTitle)
      setConfirmTarget(null)
    }
  }, [open, postTitle])

  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['merge-suggestions', 'search-into', postId, searchQuery],
    queryFn: async () => {
      const result = await findSimilarPostsFn({ data: { title: searchQuery, limit: 8 } })
      return result.filter((p) => p.id !== postId)
    },
    enabled: open && searchQuery.length >= 3,
    staleTime: 30_000,
  })

  const handleMerge = async () => {
    if (!confirmTarget) return
    setMergingId(confirmTarget.id)
    try {
      await merge.mutateAsync({
        duplicatePostId: postId,
        canonicalPostId: confirmTarget.id as PostId,
      })
      queryClient.invalidateQueries({ queryKey: ['merged-posts'] })
      toast.success('Post merged successfully')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge post')
    } finally {
      setMergingId(null)
      setConfirmTarget(null)
    }
  }

  return (
    <>
      <Dialog open={open && !confirmTarget} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="text-base">Merge into another</DialogTitle>
            <DialogDescription>Select the post to merge this feedback into.</DialogDescription>
          </DialogHeader>

          <div className="px-5 pb-3">
            <Input
              type="text"
              placeholder="Search for similar feedback..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div className="min-h-[200px] max-h-[400px] overflow-y-auto border-t border-border/40">
            {isLoading && searchQuery.length >= 3 && (
              <p className="text-sm text-muted-foreground py-6 text-center">Searching...</p>
            )}

            {suggestions && suggestions.length > 0 && (
              <div className="divide-y divide-border/30">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onClick={() => setConfirmTarget(suggestion)}
                    disabled={merge.isPending}
                    className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
                  >
                    {/* Vote count column - matches PostCard style */}
                    <div className="flex flex-col items-center justify-center shrink-0 w-11 py-1.5 rounded-lg border text-muted-foreground bg-muted/40 border-border/50">
                      <ChevronUpIcon className="h-4 w-4" />
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {suggestion.voteCount}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {suggestion.status && (
                          <StatusBadge
                            name={suggestion.status.name}
                            color={suggestion.status.color}
                          />
                        )}
                        <h3 className="font-medium text-sm text-foreground line-clamp-1 flex-1">
                          {suggestion.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="text-muted-foreground/60">
                          {suggestion.matchStrength === 'strong'
                            ? 'Strong match'
                            : suggestion.matchStrength === 'good'
                              ? 'Good match'
                              : 'Possible match'}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {suggestions && suggestions.length === 0 && searchQuery.length >= 3 && !isLoading && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No similar feedback found.
              </p>
            )}

            {searchQuery.length < 3 && !isLoading && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Type at least 3 characters to search.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge confirmation dialog */}
      <AlertDialog open={!!confirmTarget} onOpenChange={(o) => !o && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge this post?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>This post will be merged into the selected post. Votes will be combined.</p>
                <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm overflow-hidden">
                  <span className="truncate flex-1 min-w-0 font-medium text-foreground">
                    {postTitle}
                  </span>
                  <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1 min-w-0 font-medium text-foreground">
                    {confirmTarget?.title}
                  </span>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merge.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMerge} disabled={merge.isPending}>
              {mergingId ? 'Merging...' : 'Merge'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ============================================================================
// Merge Others Dialog (merge other posts INTO the current one)
// ============================================================================

interface MergeOthersDialogProps {
  postId: PostId
  postTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MergeOthersDialog({
  postId,
  postTitle,
  open,
  onOpenChange,
}: MergeOthersDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isMerging, setIsMerging] = useState(false)
  const merge = useMergePost()
  const queryClient = useQueryClient()

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSearchQuery('')
      setSelectedIds(new Set())
    }
  }, [open])

  // AI-suggested duplicates
  const { data: aiSuggestions } = useQuery({
    ...mergeSuggestionQueries.forPost(postId),
    enabled: open,
  })

  // Manual search results
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['merge-suggestions', 'search-others', postId, searchQuery],
    queryFn: async () => {
      const result = await findSimilarPostsFn({ data: { title: searchQuery, limit: 8 } })
      return result.filter((p) => p.id !== postId)
    },
    enabled: open && searchQuery.length >= 3,
    staleTime: 30_000,
  })

  // Build AI suggestion post list (deduplicated against search results)
  const aiPosts: Array<{
    id: string
    title: string
    voteCount: number
    status: { name: string; color: string } | null
    reasoning?: string
  }> = (aiSuggestions ?? [])
    .filter((suggestion) => suggestion.targetPostId === postId)
    .map((suggestion) => ({
      id: suggestion.sourcePostId,
      title: suggestion.sourcePostTitle,
      voteCount: suggestion.sourcePostVoteCount,
      status: suggestion.sourcePostStatusName
        ? {
            name: suggestion.sourcePostStatusName,
            color: suggestion.sourcePostStatusColor ?? '',
          }
        : null,
      reasoning: suggestion.llmReasoning ?? undefined,
    }))

  // Filter out AI-suggested IDs from search results to avoid duplication
  const aiPostIds = new Set(aiPosts.map((p) => p.id))
  const filteredSearchResults = searchResults?.filter((p) => !aiPostIds.has(p.id))

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleMerge = async () => {
    if (selectedIds.size === 0) return
    setIsMerging(true)
    try {
      for (const duplicateId of selectedIds) {
        await merge.mutateAsync({
          duplicatePostId: duplicateId as PostId,
          canonicalPostId: postId,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['merged-posts'] })
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ['merge-suggestions'] })
      toast.success(`Merged ${selectedIds.size} post${selectedIds.size > 1 ? 's' : ''}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge posts')
    } finally {
      setIsMerging(false)
    }
  }

  const hasAiSuggestions = aiPosts.length > 0
  const hasSearchResults = filteredSearchResults && filteredSearchResults.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base">Merge into this</DialogTitle>
          <DialogDescription>
            Select posts to merge into &ldquo;{postTitle}&rdquo;. Votes and comments will be
            combined.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-3">
          <Input
            type="text"
            placeholder="Search for similar feedback..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="min-h-[200px] max-h-[400px] overflow-y-auto border-t border-border/40">
          {/* AI Suggested section */}
          {hasAiSuggestions && (
            <>
              <div className="px-4 py-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider bg-muted/20">
                AI Suggested
              </div>
              <div className="divide-y divide-border/30">
                {aiPosts.map((post) => (
                  <MergeOthersRow
                    key={post.id}
                    title={post.title}
                    voteCount={post.voteCount}
                    status={post.status}
                    subtitle={post.reasoning}
                    selected={selectedIds.has(post.id)}
                    disabled={isMerging}
                    onToggle={() => toggleSelection(post.id)}
                  />
                ))}
              </div>
            </>
          )}

          {/* Search Results section */}
          {isLoading && searchQuery.length >= 3 && (
            <p className="text-sm text-muted-foreground py-6 text-center">Searching...</p>
          )}

          {hasSearchResults && (
            <>
              {(hasAiSuggestions || searchQuery.length >= 3) && (
                <div className="px-4 py-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider bg-muted/20">
                  Search Results
                </div>
              )}
              <div className="divide-y divide-border/30">
                {filteredSearchResults.map((post) => (
                  <MergeOthersRow
                    key={post.id}
                    title={post.title}
                    voteCount={post.voteCount}
                    status={post.status}
                    subtitle={
                      post.matchStrength === 'strong'
                        ? 'Strong match'
                        : post.matchStrength === 'good'
                          ? 'Good match'
                          : 'Possible match'
                    }
                    selected={selectedIds.has(post.id)}
                    disabled={isMerging}
                    onToggle={() => toggleSelection(post.id)}
                  />
                ))}
              </div>
            </>
          )}

          {!hasAiSuggestions && !hasSearchResults && searchQuery.length >= 3 && !isLoading && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No similar feedback found.
            </p>
          )}

          {!hasAiSuggestions && searchQuery.length < 3 && !isLoading && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Type at least 3 characters to search.
            </p>
          )}
        </div>

        {/* Footer with merge button */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/40">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isMerging}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleMerge} disabled={selectedIds.size === 0 || isMerging}>
            {isMerging
              ? 'Merging...'
              : selectedIds.size === 0
                ? 'Select posts to merge'
                : `Merge ${selectedIds.size} post${selectedIds.size > 1 ? 's' : ''}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Shared row component for MergeOthersDialog results */
function MergeOthersRow({
  title,
  voteCount,
  status,
  subtitle,
  selected,
  disabled,
  onToggle,
}: {
  title: string
  voteCount: number
  status: { name: string; color: string } | null
  subtitle?: string
  selected: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
    >
      <Checkbox checked={selected} className="shrink-0" tabIndex={-1} />

      <div className="flex flex-col items-center justify-center shrink-0 w-11 py-1.5 rounded-lg border text-muted-foreground bg-muted/40 border-border/50">
        <ChevronUpIcon className="h-4 w-4" />
        <span className="text-sm font-semibold tabular-nums text-foreground">{voteCount}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {status && <StatusBadge name={status.name} color={status.color} />}
          <h3 className="font-medium text-sm text-foreground line-clamp-1 flex-1">{title}</h3>
        </div>
        {subtitle && <p className="text-xs text-muted-foreground/60 line-clamp-1">{subtitle}</p>}
      </div>
    </button>
  )
}

// ============================================================================
// Merge Info Banner (shown on posts that have been merged into another)
// ============================================================================

interface MergeInfoBannerProps {
  mergeInfo: {
    canonicalPostId: string
    canonicalPostTitle: string
    canonicalPostBoardSlug: string
    mergedAt: Date | string
  }
  onNavigateToPost?: (postId: string) => void
}

export function MergeInfoBanner({ mergeInfo, onNavigateToPost }: MergeInfoBannerProps) {
  return (
    <div className="mx-6 mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40">
      <p className="text-sm text-amber-800 dark:text-amber-200">
        This feedback has been merged into{' '}
        <button
          type="button"
          onClick={() => onNavigateToPost?.(mergeInfo.canonicalPostId)}
          className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
        >
          {mergeInfo.canonicalPostTitle}
        </button>
      </p>
    </div>
  )
}

// ============================================================================
// Merge Actions Button (triggers the merge dialog)
// ============================================================================

interface MergeActionsProps {
  postId: PostId
  postTitle: string
  canonicalPostId?: PostId | null
  /** Controlled dialog state (optional — falls back to internal state) */
  showDialog?: boolean
  onShowDialogChange?: (show: boolean) => void
}

export function MergeActions({
  postId,
  postTitle,
  canonicalPostId,
  showDialog,
  onShowDialogChange,
}: MergeActionsProps) {
  const [internalShowDialog, setInternalShowDialog] = useState(false)
  const isDialogOpen = showDialog ?? internalShowDialog
  const setDialogOpen = onShowDialogChange ?? setInternalShowDialog

  return (
    <>
      {!canonicalPostId && (
        <MergeIntoDialog
          postId={postId}
          postTitle={postTitle}
          open={isDialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </>
  )
}
