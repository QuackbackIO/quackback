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
import { StatusBadge } from '@/components/ui/status-badge'
import { useMergePost, useUnmergePost } from '@/lib/client/mutations/post-merge'
import { findSimilarPostsFn, type SimilarPost } from '@/lib/server/functions/public-posts'
import { getMergedPostsFn } from '@/lib/server/functions/post-merge'
import type { PostId } from '@quackback/ids'
import type { MergedPostItem } from '@/lib/shared/types/inbox'

// ============================================================================
// Merged Posts List (shown on canonical posts)
// ============================================================================

interface MergedPostsListProps {
  postId: PostId
  mergedPosts?: MergedPostItem[]
}

export function MergedPostsList({ postId, mergedPosts: initialMergedPosts }: MergedPostsListProps) {
  const queryClient = useQueryClient()
  const unmerge = useUnmergePost()
  const [confirmUnmergeId, setConfirmUnmergeId] = useState<PostId | null>(null)
  const confirmTarget = initialMergedPosts?.find((p) => p.id === confirmUnmergeId)

  const { data: mergedPosts } = useQuery({
    queryKey: ['merged-posts', postId],
    queryFn: async () => {
      const result = await getMergedPostsFn({ data: { canonicalPostId: postId } })
      return result as MergedPostItem[]
    },
    initialData: initialMergedPosts,
    staleTime: 30_000,
  })

  if (!mergedPosts || mergedPosts.length === 0) return null

  const handleUnmerge = async () => {
    if (!confirmUnmergeId) return
    try {
      await unmerge.mutateAsync(confirmUnmergeId)
      queryClient.invalidateQueries({ queryKey: ['merged-posts', postId] })
      toast.success('Post unmerged successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unmerge post')
    } finally {
      setConfirmUnmergeId(null)
    }
  }

  return (
    <div className="border-t border-border/40 px-6 py-4">
      <h3 className="text-sm font-medium text-foreground mb-3">
        Merged Feedback ({mergedPosts.length})
      </h3>
      <div className="space-y-2">
        {mergedPosts.map((merged) => (
          <div
            key={merged.id}
            className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border border-border/30"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{merged.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {merged.voteCount} vote{merged.voteCount !== 1 ? 's' : ''}
                {merged.authorName ? ` · by ${merged.authorName}` : ''}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmUnmergeId(merged.id)}
              disabled={unmerge.isPending}
              className="text-xs shrink-0"
            >
              Unmerge
            </Button>
          </div>
        ))}
      </div>

      <AlertDialog
        open={!!confirmUnmergeId}
        onOpenChange={(open) => !open && setConfirmUnmergeId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unmerge this post?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget ? (
                <>
                  <span className="font-medium text-foreground">{confirmTarget.title}</span> will be
                  restored as independent feedback. Its votes will no longer count toward this post.
                </>
              ) : (
                'This post will be restored as independent feedback.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unmerge.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnmerge} disabled={unmerge.isPending}>
              {unmerge.isPending ? 'Unmerging...' : 'Unmerge'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================================
// Merge Into Dialog (shown when admin wants to mark current post as duplicate)
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
    queryKey: ['merge-suggestions', searchQuery],
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
            <DialogTitle className="text-base">Mark as Duplicate</DialogTitle>
            <DialogDescription>
              Select the original post to merge this feedback into.
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
            <AlertDialogTitle>Merge this feedback?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>This will mark the current post as a duplicate. Votes will be combined.</p>
                <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                  <span className="truncate font-medium text-foreground">{postTitle}</span>
                  <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">
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
  mergedPosts?: MergedPostItem[]
  /** Controlled dialog state (optional — falls back to internal state) */
  showDialog?: boolean
  onShowDialogChange?: (show: boolean) => void
}

export function MergeActions({
  postId,
  postTitle,
  canonicalPostId,
  mergedPosts,
  showDialog,
  onShowDialogChange,
}: MergeActionsProps) {
  const [internalShowDialog, setInternalShowDialog] = useState(false)
  const isDialogOpen = showDialog ?? internalShowDialog
  const setDialogOpen = onShowDialogChange ?? setInternalShowDialog

  // If this post is a canonical post with merged posts, show the list
  const hasMergedPosts = mergedPosts && mergedPosts.length > 0

  return (
    <>
      {hasMergedPosts && <MergedPostsList postId={postId} mergedPosts={mergedPosts} />}

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
