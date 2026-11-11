import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { StatusColourDot } from '@/components/ui/status-badge'
import { useIntl } from 'react-intl'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { RoadmapCard } from './roadmap-card'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  usePublicRoadmapPosts,
  flattenRoadmapViewPosts,
} from '@/lib/client/hooks/use-roadmap-posts-query'
import type { RoadmapId, PostStatusId } from '@quackback/ids'
import type { RoadmapFilters } from '@/lib/shared/types'

interface RoadmapColumnProps {
  roadmapId: RoadmapId
  statusId?: PostStatusId
  bucketId?: string
  title: string
  icon?: string | null
  color: string
  filters?: RoadmapFilters
  /** A column on a board, or a group down a list. */
  layout?: 'column' | 'group'
}

export function RoadmapColumn({
  roadmapId,
  statusId,
  bucketId,
  title,
  icon,
  color,
  filters,
  layout = 'column',
}: RoadmapColumnProps) {
  const headingId = `roadmap-group-${statusId ?? bucketId ?? title}`
  const intl = useIntl()
  const { data, isFetchingNextPage, hasNextPage, fetchNextPage, isLoading } = usePublicRoadmapPosts(
    {
      roadmapId,
      statusId,
      bucketId,
      filters,
    }
  )

  const posts = flattenRoadmapViewPosts(data)
  const total = data?.pages[0]?.total ?? 0

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNextPage,
    isFetching: isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })

  const cards = posts.map((post, index) => (
    <div
      key={post.id}
      className="animate-in fade-in duration-200 fill-mode-backwards"
      style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
    >
      <RoadmapCard
        id={post.id}
        title={post.title}
        voteCount={post.voteCount}
        commentCount={post.commentCount}
        board={{ id: post.board.id, slug: post.board.slug, name: post.board.name }}
        eta={post.eta}
        voting
      />
    </div>
  ))
  const more = hasNextPage && (
    <div ref={sentinelRef} className="py-2 flex justify-center">
      {isFetchingNextPage && (
        <ArrowPathIcon className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
    </div>
  )
  const empty = (
    <p className="text-sm text-muted-foreground">
      {intl.formatMessage({
        id: 'portal.roadmap.column.empty',
        defaultMessage: 'No items yet',
      })}
    </p>
  )

  if (layout === 'group')
    return (
      <section
        aria-labelledby={headingId}
        data-qb-loading={isLoading || undefined}
        className="space-y-3"
      >
        <div className="flex items-center gap-2">
          <StatusColourDot colour={color} className="size-3" />
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            {icon && (
              <span className="me-1.5" aria-hidden>
                {icon}
              </span>
            )}
            {title}
          </h2>
          <Badge variant="secondary" className="text-xs">
            {total}
          </Badge>
        </div>
        {isLoading ? (
          <CardSkeletons count={GROUP_LOADING_CARDS} />
        ) : posts.length === 0 ? (
          empty
        ) : (
          <div className="space-y-2">
            {cards}
            {more}
          </div>
        )}
      </section>
    )

  return (
    <Card className="w-full flex flex-col h-full">
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusColourDot colour={color} className="size-3" />
            <CardTitle className="text-base">
              {icon && (
                <span className="me-1.5" aria-hidden>
                  {icon}
                </span>
              )}
              {title}
            </CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            {total}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full px-6 pb-6">
          {isLoading ? (
            <CardSkeletons count={COLUMN_LOADING_CARDS} />
          ) : posts.length === 0 ? (
            <div className="h-full flex items-center justify-center py-8 animate-in fade-in duration-200">
              {empty}
            </div>
          ) : (
            <div className="space-y-2">
              {cards}
              {more}
            </div>
          )}
          <ScrollBar />
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

/**
 * A column's cards while its posts load: room for the first few, so it does
 * not grow from a heading to its cards when they arrive. The look is
 * ui/Skeleton's (qb-skeleton), as importing it would add its chunk to the
 * roadmap page.
 */
function CardSkeletons({ count }: { count: number }) {
  return (
    <div aria-hidden="true" data-qb-skeleton="roadmap-cards" className="space-y-2">
      {Array.from({ length: count }, (_, at) => (
        <div key={at} className="qb-skeleton h-20" />
      ))}
    </div>
  )
}

/** How many cards a loading column on a board holds room for. */
const COLUMN_LOADING_CARDS = 3

/**
 * A loading group down a list holds a screen of cards, and the list hides the
 * groups after it until it loads (ROADMAP_GROUPS_CLASS). A group can hold
 * twenty cards, so room for a few would still push every group below it down
 * the page when they arrived; the next group now first appears where the
 * cards end, below the visitor's screen or in place of a placeholder.
 */
const GROUP_LOADING_CARDS = 10

/** The list of groups: a group after one still loading stays hidden. */
export const ROADMAP_GROUPS_CLASS = 'space-y-8 pb-4 [&>[data-qb-loading]~section]:hidden'
