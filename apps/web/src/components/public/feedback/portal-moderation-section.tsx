/**
 * Portal moderation banner — team-only. Pending posts now render in the
 * normal feed (for post.approve holders) with inline Approve/Reject, so
 * this section is just an attention cue plus a link to the admin queue.
 */
import { useIntl, FormattedMessage } from 'react-intl'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ExclamationTriangleIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { listPendingPostsFn, listPendingCommentsFn } from '@/lib/server/functions/moderation'

const pendingPostsKey = ['portal', 'moderation', 'pending', 'posts'] as const
const pendingCommentsKey = ['portal', 'moderation', 'pending', 'comments'] as const

interface PortalModerationSectionProps {
  /** True only for viewers holding post.approve. Gates the query and all markup. */
  enabled: boolean
}

export function PortalModerationSection({
  enabled,
}: PortalModerationSectionProps): React.ReactElement | null {
  const intl = useIntl()
  const postsQuery = useQuery({
    queryKey: pendingPostsKey,
    queryFn: () => listPendingPostsFn(),
    enabled,
    staleTime: 30 * 1000,
  })
  const commentsQuery = useQuery({
    queryKey: pendingCommentsKey,
    queryFn: () => listPendingCommentsFn(),
    enabled,
    staleTime: 30 * 1000,
  })

  const postCount = postsQuery.data?.posts.length ?? 0
  const commentCount = commentsQuery.data?.comments.length ?? 0
  const total = postCount + commentCount

  if (!enabled || total === 0) return null

  return (
    <section
      className="mt-5"
      aria-label={intl.formatMessage({
        id: 'portal.moderation.banner.regionLabel',
        defaultMessage: 'Items pending approval',
      })}
    >
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm"
        aria-live="polite"
      >
        <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <span className="font-medium text-amber-800 dark:text-amber-200">
          <FormattedMessage
            id="portal.moderation.banner.count"
            defaultMessage="{count, plural, one {# item is} other {# items are}} waiting for review — they appear in the feed and comment threads"
            values={{ count: total }}
          />
        </span>
        <Link
          to="/admin/moderation"
          className="ms-auto inline-flex items-center gap-1 font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
        >
          <FormattedMessage
            id="portal.moderation.banner.openQueue"
            defaultMessage="Open queue in admin"
          />
          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  )
}
