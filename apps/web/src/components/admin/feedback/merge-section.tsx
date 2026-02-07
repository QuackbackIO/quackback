'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMergePost, useUnmergePost } from '@/lib/client/mutations/post-merge'
import { findSimilarPostsFn } from '@/lib/server/functions/public-posts'
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

  const handleUnmerge = async (duplicatePostId: PostId) => {
    try {
      await unmerge.mutateAsync(duplicatePostId)
      queryClient.invalidateQueries({ queryKey: ['merged-posts', postId] })
      toast.success('Post unmerged successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unmerge post')
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
              onClick={() => handleUnmerge(merged.id)}
              disabled={unmerge.isPending}
              className="text-xs shrink-0"
            >
              Unmerge
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Merge Into Dialog (shown when admin wants to mark current post as duplicate)
// ============================================================================

interface MergeIntoDialogProps {
  postId: PostId
  postTitle: string
  onClose: () => void
}

export function MergeIntoDialog({ postId, onClose }: MergeIntoDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const merge = useMergePost()
  const queryClient = useQueryClient()

  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['merge-suggestions', searchQuery],
    queryFn: async () => {
      const result = await findSimilarPostsFn({ data: { title: searchQuery, limit: 5 } })
      // Filter out the current post from suggestions
      return result.filter((p) => p.id !== postId)
    },
    enabled: searchQuery.length >= 3,
    staleTime: 30_000,
  })

  const handleMerge = async (canonicalPostId: string) => {
    try {
      await merge.mutateAsync({
        duplicatePostId: postId,
        canonicalPostId: canonicalPostId as PostId,
      })
      queryClient.invalidateQueries({ queryKey: ['merged-posts'] })
      toast.success('Post merged successfully')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge post')
    }
  }

  return (
    <div className="border-t border-border/40 px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Mark as Duplicate</h3>
        <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Search for the canonical feedback item to merge this post into.
      </p>
      <Input
        type="text"
        placeholder="Search for similar feedback..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="mb-3"
        autoFocus
      />
      {isLoading && searchQuery.length >= 3 && (
        <p className="text-xs text-muted-foreground py-2">Searching...</p>
      )}
      {suggestions && suggestions.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => handleMerge(suggestion.id)}
              disabled={merge.isPending}
              className="w-full text-left p-2.5 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/40"
            >
              <p className="text-sm font-medium text-foreground truncate">{suggestion.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {suggestion.voteCount} vote{suggestion.voteCount !== 1 ? 's' : ''}
                </span>
                {suggestion.status && (
                  <span
                    className="inline-flex items-center gap-1 text-xs"
                    style={{ color: suggestion.status.color }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: suggestion.status.color }}
                    />
                    {suggestion.status.name}
                  </span>
                )}
                <span className="text-xs text-muted-foreground/60">
                  {suggestion.matchStrength === 'strong'
                    ? 'Strong match'
                    : suggestion.matchStrength === 'good'
                      ? 'Good match'
                      : 'Possible match'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      {suggestions && suggestions.length === 0 && searchQuery.length >= 3 && !isLoading && (
        <p className="text-xs text-muted-foreground py-2">No similar feedback found.</p>
      )}
    </div>
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
}

export function MergeActions({
  postId,
  postTitle,
  canonicalPostId,
  mergedPosts,
}: MergeActionsProps) {
  const [showMergeDialog, setShowMergeDialog] = useState(false)

  // If this post is merged into another, show the banner
  // Note: mergeInfo is handled separately in the post modal

  // If this post is a canonical post with merged posts, show the list
  const hasMergedPosts = mergedPosts && mergedPosts.length > 0

  return (
    <>
      {hasMergedPosts && <MergedPostsList postId={postId} mergedPosts={mergedPosts} />}

      {!canonicalPostId && (
        <>
          {showMergeDialog ? (
            <MergeIntoDialog
              postId={postId}
              postTitle={postTitle}
              onClose={() => setShowMergeDialog(false)}
            />
          ) : (
            <div className="border-t border-border/40 px-6 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMergeDialog(true)}
                className="text-xs"
              >
                Mark as Duplicate
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
