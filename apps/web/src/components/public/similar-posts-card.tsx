'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LightBulbIcon } from '@heroicons/react/24/solid'
import { CompactPostCard } from '@/components/shared/compact-post-card'
import { VoteButton } from '@/components/public/vote-button'
import type { MatchStrength, SimilarPost } from '@/lib/client/hooks/use-similar-posts'
import { cn } from '@/lib/shared/utils'
import type { PostId } from '@quackback/ids'

const MATCH_STRENGTH_LABELS: Record<MatchStrength, string> = {
  strong: 'Very similar',
  good: 'Similar',
  weak: 'Related',
}

interface SimilarPostItemProps {
  post: SimilarPost
}

function SimilarPostItem({ post }: SimilarPostItemProps): React.ReactElement {
  const matchLabel = post.matchStrength ? MATCH_STRENGTH_LABELS[post.matchStrength] : null

  return (
    <CompactPostCard
      title={post.title}
      voteCount={post.voteCount}
      voteSlot={<VoteButton postId={post.id as PostId} voteCount={post.voteCount} pill />}
      label={matchLabel ?? undefined}
      statusName={post.status?.name}
      statusColor={post.status?.color}
      onClick={() => window.open(`/b/${post.boardSlug}/posts/${post.id}`, '_blank')}
      className="border-0 bg-transparent p-0"
    />
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
