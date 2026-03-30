import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PostId } from '@featurepool/ids'
import type { ActivityType } from '@/lib/server/domains/activity/activity.service'
import { activityQueries } from '@/lib/client/queries/activity'
import { useUnmergePost } from '@/lib/client/mutations/post-merge'
import { CompactPostCard } from '@/components/shared/compact-post-card'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  PlusIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
  UserIcon,
  TagIcon,
  MapIcon,
  LockClosedIcon,
  LockOpenIcon,
  ChatBubbleLeftIcon,
  HandThumbUpIcon,
  FolderIcon,
} from '@heroicons/react/16/solid'
import { IconGitMerge } from '@tabler/icons-react'
import { SOURCE_TYPE_LABELS } from '@/components/admin/feedback/source-type-icon'
import { getLatestMergeStateByDuplicateId } from './post-activity-timeline.utils'

// ============================================
// Types
// ============================================

interface ActivityItem {
  id: string
  postId: string
  principalId: string | null
  type: ActivityType
  metadata: Record<string, unknown>
  createdAt: string
  actorName: string | null
}

// ============================================
// Activity type display config
// ============================================

interface ActivityDisplayConfig {
  icon: React.ComponentType<{ className?: string }>
  label: (metadata: Record<string, unknown>, actorName: string | null) => string
  detail?: (metadata: Record<string, unknown>) => React.ReactNode
}

const actorLabel = (name: string | null) => name ?? 'System'

const SUGGESTION_TYPE_LABELS: Record<string, string> = {
  create_post: 'create',
  vote_on_post: 'vote',
  duplicate_post: 'merge',
}

const ACTIVITY_CONFIG: Partial<Record<ActivityType, ActivityDisplayConfig>> = {
  'post.created': {
    icon: PlusIcon,
    label: (m, a) =>
      m.source === 'feedback_suggestion'
        ? `${actorLabel(a)} created this post from feedback`
        : `${actorLabel(a)} created this post`,
    detail: (m) => {
      if (m.source === 'feedback_suggestion') {
        const typeLabel =
          SUGGESTION_TYPE_LABELS[m.suggestionType as string] ?? (m.suggestionType as string)
        return m.suggestionType ? (
          <span className="text-xs text-muted-foreground">via {typeLabel} suggestion</span>
        ) : null
      }
      return m.boardName ? `in ${m.boardName as string}` : undefined
    },
  },
  'vote.proxy': {
    icon: HandThumbUpIcon,
    label: (m, a) => {
      const voter = m.voterName as string | undefined
      return voter
        ? `${actorLabel(a)} voted on behalf of ${voter}`
        : `${actorLabel(a)} added a proxy vote`
    },
    detail: (m) => {
      const st = m.sourceType as string | undefined
      return st ? (
        <span className="text-xs text-muted-foreground">via {SOURCE_TYPE_LABELS[st] ?? st}</span>
      ) : null
    },
  },
  'vote.removed': {
    icon: HandThumbUpIcon,
    label: (m, a) => {
      const voter = m.voterName as string | undefined
      return voter ? `${actorLabel(a)} removed ${voter}'s vote` : `${actorLabel(a)} removed a vote`
    },
  },
  'post.deleted': {
    icon: TrashIcon,
    label: (_, a) => `${actorLabel(a)} deleted this post`,
  },
  'post.restored': {
    icon: ArrowUturnLeftIcon,
    label: (_, a) => `${actorLabel(a)} restored this post`,
  },
  'status.changed': {
    icon: ChatBubbleLeftIcon,
    label: (_, a) => `${actorLabel(a)} changed status`,
    detail: (m) => {
      const from = m.fromName as string | undefined
      const to = m.toName as string | undefined
      if (!from && !to) return null
      return (
        <span className="text-xs text-muted-foreground">
          {from && (
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium mr-1"
              style={{
                backgroundColor: `${(m.fromColor as string) ?? '#888'}20`,
                color: (m.fromColor as string) ?? '#888',
              }}
            >
              {from}
            </span>
          )}
          <span className="mx-0.5">&rarr;</span>
          {to && (
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ml-1"
              style={{
                backgroundColor: `${(m.toColor as string) ?? '#888'}20`,
                color: (m.toColor as string) ?? '#888',
              }}
            >
              {to}
            </span>
          )}
        </span>
      )
    },
  },
  'post.board_changed': {
    icon: FolderIcon,
    label: (_, a) => `${actorLabel(a)} moved to a different board`,
    detail: (m) => {
      const from = m.fromBoardName as string | undefined
      const to = m.toBoardName as string | undefined
      if (!from && !to) return null
      return (
        <span className="text-xs text-muted-foreground">
          {from} &rarr; {to}
        </span>
      )
    },
  },
  'post.merged_in': {
    icon: IconGitMerge,
    label: (_, a) => `${actorLabel(a)} merged in a post`,
    // Detail rendered by MergedInCard below (not the standard detail function)
  },
  'post.merged_away': {
    icon: IconGitMerge,
    label: (_, a) => `${actorLabel(a)} merged this into another post`,
    detail: (m) => (
      <span className="text-xs text-muted-foreground truncate">
        {m.canonicalPostTitle as string}
      </span>
    ),
  },
  'post.unmerged': {
    icon: ArrowUturnLeftIcon,
    label: (_, a) => `${actorLabel(a)} unmerged a post`,
    detail: (m) => (
      <span className="text-xs text-muted-foreground truncate">{m.otherPostTitle as string}</span>
    ),
  },
  'owner.assigned': {
    icon: UserIcon,
    label: (m, a) => `${actorLabel(a)} assigned ${(m.ownerName as string) ?? 'someone'}`,
    detail: (m) =>
      m.previousOwnerName ? (
        <span className="text-xs text-muted-foreground">
          Previously: {m.previousOwnerName as string}
        </span>
      ) : null,
  },
  'owner.unassigned': {
    icon: UserIcon,
    label: (_, a) => `${actorLabel(a)} removed assignee`,
    detail: (m) =>
      m.previousOwnerName ? (
        <span className="text-xs text-muted-foreground">
          Previously: {m.previousOwnerName as string}
        </span>
      ) : null,
  },
  'tags.added': {
    icon: TagIcon,
    label: (_, a) => `${actorLabel(a)} added tags`,
    detail: (m) => {
      const names = m.tagNames as string[] | undefined
      if (!names?.length) return null
      return (
        <span className="flex flex-wrap gap-1">
          {names.map((name) => (
            <span
              key={name}
              className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {name}
            </span>
          ))}
        </span>
      )
    },
  },
  'tags.removed': {
    icon: TagIcon,
    label: (_, a) => `${actorLabel(a)} removed tags`,
    detail: (m) => {
      const names = m.tagNames as string[] | undefined
      if (!names?.length) return null
      return (
        <span className="flex flex-wrap gap-1">
          {names.map((name) => (
            <span
              key={name}
              className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground line-through"
            >
              {name}
            </span>
          ))}
        </span>
      )
    },
  },
  'roadmap.added': {
    icon: MapIcon,
    label: (_, a) => `${actorLabel(a)} added to roadmap`,
    detail: (m) => <span className="text-xs text-muted-foreground">{m.roadmapName as string}</span>,
  },
  'roadmap.removed': {
    icon: MapIcon,
    label: (_, a) => `${actorLabel(a)} removed from roadmap`,
    detail: (m) => <span className="text-xs text-muted-foreground">{m.roadmapName as string}</span>,
  },
  'comments.locked': {
    icon: LockClosedIcon,
    label: (_, a) => `${actorLabel(a)} locked comments`,
  },
  'comments.unlocked': {
    icon: LockOpenIcon,
    label: (_, a) => `${actorLabel(a)} unlocked comments`,
  },
  'comment.pinned': {
    icon: ChatBubbleLeftIcon,
    label: (_, a) => `${actorLabel(a)} pinned a response`,
  },
  'comment.unpinned': {
    icon: ChatBubbleLeftIcon,
    label: (_, a) => `${actorLabel(a)} unpinned the response`,
  },
  'comment.deleted': {
    icon: TrashIcon,
    label: (_, a) => `${actorLabel(a)} deleted their comment`,
  },
  'comment.removed': {
    icon: TrashIcon,
    label: (_, a) => `${actorLabel(a)} removed a comment`,
  },
  'comment.restored': {
    icon: ArrowUturnLeftIcon,
    label: (_, a) => `${actorLabel(a)} restored a comment`,
  },
}

// ============================================
// Merged-in inline card (with unmerge action)
// ============================================

function MergedInCard({ activity, isUnmerged }: { activity: ActivityItem; isUnmerged: boolean }) {
  const queryClient = useQueryClient()
  const unmerge = useUnmergePost()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const duplicatePostId = activity.metadata.duplicatePostId as string | undefined
  const title = (activity.metadata.duplicatePostTitle as string) || 'Untitled'
  const voteCount = (activity.metadata.duplicateVoteCount as number) ?? 0
  const authorName = activity.metadata.duplicateAuthorName as string | null

  const handleUnmerge = async () => {
    if (!duplicatePostId) return
    try {
      await unmerge.mutateAsync(duplicatePostId as PostId)
      queryClient.invalidateQueries({ queryKey: ['activity', 'post'] })
      toast.success('Post unmerged successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unmerge post')
    } finally {
      setConfirmOpen(false)
    }
  }

  const unmergeAction =
    duplicatePostId && !isUnmerged ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={unmerge.isPending}
        className="text-xs shrink-0"
      >
        Unmerge
      </Button>
    ) : undefined

  return (
    <>
      <CompactPostCard
        title={title}
        voteCount={voteCount}
        authorName={authorName}
        actions={unmergeAction}
        className="mt-1.5"
      />

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !open && setConfirmOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unmerge this post?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{title}</span> will be restored as
              independent feedback. Its votes will no longer count toward this post.
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
    </>
  )
}

// ============================================
// Component
// ============================================

function ActivityEntry({
  activity,
  mergeStateByDuplicateId,
}: {
  activity: ActivityItem
  mergeStateByDuplicateId: Map<string, boolean>
}) {
  const config = ACTIVITY_CONFIG[activity.type]
  if (!config) return null

  const Icon = config.icon
  const label = config.label(activity.metadata, activity.actorName)
  const detail = activity.type === 'post.merged_in' ? null : config.detail?.(activity.metadata)
  const duplicatePostId = activity.metadata.duplicatePostId as string | undefined

  const isUnmerged =
    activity.type === 'post.merged_in' && !!duplicatePostId
      ? mergeStateByDuplicateId.get(duplicatePostId) === true
      : false

  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm text-foreground">{label}</p>
          <TimeAgo date={activity.createdAt} className="shrink-0 text-xs text-muted-foreground" />
        </div>
        {detail && <div className="mt-0.5">{detail}</div>}
        {activity.type === 'post.merged_in' && (
          <MergedInCard activity={activity} isUnmerged={isUnmerged} />
        )}
      </div>
    </div>
  )
}

export function PostActivityTimeline({ postId }: { postId: PostId }) {
  const { data, isLoading } = useQuery(activityQueries.forPost(postId))
  const activities = data as unknown as ActivityItem[] | undefined
  const mergeStateByDuplicateId = getLatestMergeStateByDuplicateId(activities ?? [])

  if (isLoading) {
    return (
      <div className="space-y-3 px-6 py-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!activities?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">No activity recorded yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Activity will appear here as changes are made to this post
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border px-6">
      {activities.map((activity) => (
        <ActivityEntry
          key={activity.id}
          activity={activity}
          mergeStateByDuplicateId={mergeStateByDuplicateId}
        />
      ))}
    </div>
  )
}
