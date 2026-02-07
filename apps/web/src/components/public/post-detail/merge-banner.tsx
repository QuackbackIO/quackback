'use client'

import { Link } from '@tanstack/react-router'

interface PortalMergeBannerProps {
  canonicalPostTitle: string
  canonicalPostBoardSlug: string
  canonicalPostId: string
}

/**
 * Banner shown on the portal when viewing a post that has been merged into another.
 * Informs the user and links them to the canonical post.
 */
export function PortalMergeBanner({
  canonicalPostTitle,
  canonicalPostBoardSlug,
  canonicalPostId,
}: PortalMergeBannerProps) {
  return (
    <div
      className="mb-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
      style={{ animationDelay: '75ms' }}
    >
      <p className="text-sm text-amber-800 dark:text-amber-200">
        This feedback has been merged into{' '}
        <Link
          to="/b/$slug/posts/$postId"
          params={{ slug: canonicalPostBoardSlug, postId: canonicalPostId }}
          className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
        >
          {canonicalPostTitle}
        </Link>
        . Votes and activity now count toward the linked item.
      </p>
    </div>
  )
}
