'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Link } from '@tanstack/react-router'
import { ChevronUpIcon, LightBulbIcon } from '@heroicons/react/24/solid'
import { StatusBadge } from '@/components/ui/status-badge'
import { usePostVote } from '@/lib/hooks/use-post-vote'
import { cn } from '@/lib/utils'
import type { SimilarPost } from '@/lib/hooks/use-similar-posts'
import type { PostId } from '@quackback/ids'

// ============================================================================
// Similar Post Item
// ============================================================================

interface SimilarPostItemProps {
  post: SimilarPost
}

function SimilarPostItem({ post }: SimilarPostItemProps) {
  const { voteCount, hasVoted, isPending, handleVote } = usePostVote({
    postId: post.id as PostId,
    voteCount: post.voteCount,
  })

  const postUrl = `/b/${post.boardSlug}/posts/${post.id}`

  return (
    <div className="flex items-stretch rounded-lg border border-border/50 bg-card overflow-hidden transition-colors hover:border-border">
      {/* Vote button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          handleVote(e)
        }}
        disabled={isPending}
        aria-label={hasVoted ? 'Remove vote' : 'Vote for this post'}
        aria-pressed={hasVoted}
        className={cn(
          'flex flex-col items-center justify-center w-12 shrink-0 border-r border-border/30 transition-colors',
          hasVoted
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          isPending && 'opacity-50 cursor-wait'
        )}
      >
        <ChevronUpIcon className={cn('h-4 w-4 transition-transform', hasVoted && 'text-primary')} />
        <span className="text-xs font-bold tabular-nums">{voteCount}</span>
      </button>

      {/* Post info */}
      <Link
        to={postUrl}
        target="_blank"
        className="flex-1 min-w-0 p-2.5 hover:bg-muted/30 transition-colors"
      >
        <p className="text-sm font-medium text-foreground line-clamp-1 mb-1">{post.title}</p>
        {post.status && (
          <StatusBadge name={post.status.name} color={post.status.color} className="text-[10px]" />
        )}
      </Link>
    </div>
  )
}

// ============================================================================
// Loading State (kept for potential future use)
// ============================================================================

function _LoadingIndicator() {
  return (
    <div className="flex items-center gap-2 py-2 px-3 text-xs text-muted-foreground">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
        <span
          className="h-1.5 w-1.5 rounded-full bg-current animate-pulse"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-current animate-pulse"
          style={{ animationDelay: '300ms' }}
        />
      </div>
      <span>Checking for similar feedback...</span>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

interface SimilarPostsSuggestionsProps {
  /** Similar posts to display */
  posts: SimilarPost[]
  /** Whether data is currently loading */
  isLoading: boolean
  /** Whether to show the component (controls visibility) */
  show: boolean
  /** Optional className */
  className?: string
}

/**
 * Displays similar posts when the user is creating new feedback.
 * Helps reduce duplicates by showing existing discussions they can vote on.
 *
 * Design principles:
 * - Non-blocking: User can still submit their post
 * - Positive framing: "Others have requested this" not "Duplicate detected"
 * - Actionable: One-click voting on similar posts
 * - Smooth animations: Appears naturally without jarring the user
 */
export function SimilarPostsSuggestions({
  posts,
  isLoading,
  show,
  className,
}: SimilarPostsSuggestionsProps) {
  // Only show if we have posts to display
  // Don't show loading state to avoid flicker - it's fast enough
  const showResults = show && posts.length > 0 && !isLoading

  if (!showResults) return null

  return (
    <AnimatePresence mode="wait">
      {showResults && (
        <motion.div
          key="results"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className={cn('overflow-hidden', className)}
        >
          <div className="rounded-lg border border-amber-200/50 bg-amber-50/50 dark:border-amber-800/30 dark:bg-amber-950/20 p-3">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <LightBulbIcon className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Similar requests from the community
              </p>
            </div>

            {/* Post list */}
            <div className="space-y-2">
              {posts.map((post) => (
                <SimilarPostItem key={post.id} post={post} />
              ))}
            </div>

            {/* Footer hint */}
            <p className="text-[11px] text-amber-700/70 dark:text-amber-300/60 mt-3">
              Vote to show support, or continue below if your request is different.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
