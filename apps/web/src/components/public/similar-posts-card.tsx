'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LightBulbIcon } from '@heroicons/react/24/outline'
import { VoteButton } from '@/components/public/vote-button'
import type { SimilarPost } from '@/lib/client/hooks/use-similar-posts'
import { cn } from '@/lib/shared/utils'
import type { PostId } from '@quackback/ids'

interface SimilarPostsCardProps {
  posts: SimilarPost[]
  show: boolean
  className?: string
}

function useContentHeight() {
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
              <LightBulbIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
              Similar ideas
            </p>
            <div className="space-y-1.5">
              {posts.slice(0, MAX_SIMILAR_POSTS).map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => window.open(`/b/${post.boardSlug}/posts/${post.id}`, '_blank')}
                  className="flex items-center gap-2.5 w-full rounded-lg hover:bg-muted/30 transition-colors px-2 py-1.5 cursor-pointer text-left"
                >
                  <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <VoteButton postId={post.id as PostId} voteCount={post.voteCount} pill />
                  </div>
                  <div className="flex-1 min-w-0">
                    {post.status && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span
                          className="size-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: post.status.color }}
                        />
                        {post.status.name}
                      </span>
                    )}
                    <p className="text-sm font-semibold text-foreground line-clamp-1">
                      {post.title}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
