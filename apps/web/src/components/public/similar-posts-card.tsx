'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronUpIcon, LightBulbIcon } from '@heroicons/react/24/solid'
import { StatusBadge } from '@/components/ui/status-badge'
import type { MatchStrength, SimilarPost } from '@/lib/client/hooks/use-similar-posts'
import { usePostVote } from '@/lib/client/hooks/use-post-vote'
import { cn } from '@/lib/utils'
import type { PostId } from '@quackback/ids'

const MATCH_STRENGTH_CONFIG: Record<MatchStrength, { label: string; textClass: string }> = {
  strong: { label: 'Very similar', textClass: 'text-green-600 dark:text-green-500' },
  good: { label: 'Similar', textClass: 'text-blue-600 dark:text-blue-500' },
  weak: { label: 'Related', textClass: 'text-muted-foreground' },
}

interface SimilarPostItemProps {
  post: SimilarPost
}

function SimilarPostItem({ post }: SimilarPostItemProps): React.ReactElement {
  const { voteCount, hasVoted, isPending, handleVote } = usePostVote({
    postId: post.id as PostId,
    voteCount: post.voteCount,
  })

  const postUrl = `/b/${post.boardSlug}/posts/${post.id}`
  const matchConfig = post.matchStrength ? MATCH_STRENGTH_CONFIG[post.matchStrength] : null

  return (
    <div className="flex gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50 min-w-0 -mx-2">
      <button
        type="button"
        onClick={handleVote}
        disabled={isPending}
        aria-label={hasVoted ? 'Remove vote' : 'Vote for this post'}
        aria-pressed={hasVoted}
        className={cn(
          'flex flex-col items-center justify-center shrink-0 w-10 rounded transition-colors',
          hasVoted
            ? 'bg-primary/10 text-primary'
            : 'bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60',
          isPending && 'opacity-50 cursor-wait'
        )}
      >
        <ChevronUpIcon className={cn('h-4 w-4', hasVoted && 'text-primary')} />
        <span className="text-xs font-semibold tabular-nums">{voteCount}</span>
      </button>

      <Link to={postUrl} target="_blank" className="flex-1 min-w-0 py-0.5 group">
        <p className="text-sm text-foreground truncate group-hover:text-primary transition-colors">
          {post.title}
        </p>
        <p className="flex items-center gap-1.5 text-[11px] mt-0.5">
          {matchConfig && (
            <span className={cn('font-medium', matchConfig.textClass)}>{matchConfig.label}</span>
          )}
          {matchConfig && post.status && <span className="text-muted-foreground/40">·</span>}
          {post.status && (
            <StatusBadge
              name={post.status.name}
              color={post.status.color}
              className="text-[10px]"
            />
          )}
        </p>
      </Link>
    </div>
  )
}

interface SimilarPostsCardProps {
  /** Similar posts to display */
  posts: SimilarPost[]
  /** Whether to show the card */
  show: boolean
  /** Optional className */
  className?: string
}

interface ContentHeightResult {
  ref: React.RefObject<HTMLDivElement | null>
  height: number
}

function useContentHeight(): ContentHeightResult {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setHeight(entry.contentRect.height)
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, height }
}

const MAX_SIMILAR_POSTS = 3

/**
 * Displays similar posts in a compact card above the submit button.
 */
export function SimilarPostsCard({
  posts,
  show,
  className,
}: SimilarPostsCardProps): React.ReactElement {
  const showCard = show && posts.length > 0
  const { ref: contentRef, height: measuredHeight } = useContentHeight()

  return (
    <AnimatePresence>
      {showCard && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: measuredHeight || 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn('overflow-hidden', className)}
        >
          <div ref={contentRef}>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2">
              <LightBulbIcon className="h-3 w-3 text-amber-500/70" />
              Similar requests from the community
            </p>
            <div className="space-y-1">
              {posts.slice(0, MAX_SIMILAR_POSTS).map((post) => (
                <SimilarPostItem key={post.id} post={post} />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
