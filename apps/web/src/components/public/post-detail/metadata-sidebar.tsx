import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  FolderIcon,
  CalendarIcon,
  UserIcon,
  MapIcon,
  TagIcon,
  ChevronUpIcon,
  PlusIcon,
  XMarkIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { portalDetailQueries } from '@/lib/client/queries/portal-detail'
import { StatusDropdown } from '@/components/shared/status-dropdown'
import { StatusBadge } from '@/components/ui/status-badge'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TimeAgo } from '@/components/ui/time-ago'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { VoteButton } from '@/components/public/vote-button'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import { cn, getInitials } from '@/lib/shared/utils'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import type { PostId, StatusId, TagId, RoadmapId } from '@quackback/ids'

export function MetadataSidebarSkeleton() {
  return (
    <div className="hidden lg:block w-72 shrink-0 border-l border-border/30 bg-muted/5 p-4 space-y-5">
      {/* Upvotes */}
      <Skeleton className="h-12 w-full rounded-lg" />
      {/* Status */}
      <Skeleton className="h-8 w-full" />
      {/* Board */}
      <Skeleton className="h-8 w-full" />
      {/* Tags */}
      <Skeleton className="h-8 w-full" />
      {/* Roadmaps */}
      <Skeleton className="h-8 w-full" />
      {/* Date */}
      <Skeleton className="h-8 w-full" />
      {/* Author */}
      <Skeleton className="h-8 w-full" />
    </div>
  )
}

function NoneLabel() {
  return <span className="text-sm italic text-muted-foreground">None</span>
}

interface MetadataSidebarProps {
  postId: PostId
  voteCount: number
  status?: { id: string; name: string; color: string | null } | null
  board: { name: string; slug: string }
  authorName: string | null
  authorAvatarUrl?: string | null
  createdAt: Date
  tags?: Array<{ id: string; name: string; color: string }>
  roadmaps?: Array<{ id: string; name: string; slug: string }>

  // Admin mode props (all optional)
  /** Enable admin mode with editable metadata */
  canEdit?: boolean
  /** All available statuses for dropdown */
  allStatuses?: PostStatusEntity[]
  /** All available tags for selection */
  allTags?: Array<{ id: string; name: string; color: string }>
  /** All available roadmaps for selection */
  allRoadmaps?: Array<{ id: string; name: string; slug: string }>
  /** Callback when status changes */
  onStatusChange?: (statusId: StatusId) => Promise<void>
  /** Callback when tags change */
  onTagsChange?: (tagIds: TagId[]) => Promise<void>
  /** Callback when roadmap added */
  onRoadmapAdd?: (roadmapId: RoadmapId) => Promise<void>
  /** Callback when roadmap removed */
  onRoadmapRemove?: (roadmapId: RoadmapId) => Promise<void>
  /** Whether metadata update is in progress */
  isUpdating?: boolean
  /** Hide subscribe section (for admin context) */
  hideSubscribe?: boolean
  /** Hide vote button (for admin context where voting is handled differently) */
  hideVote?: boolean
}

export function MetadataSidebar({
  postId,
  voteCount,
  status,
  board,
  authorName,
  authorAvatarUrl,
  createdAt,
  tags = [],
  roadmaps = [],
  canEdit = false,
  allStatuses = [],
  allTags = [],
  allRoadmaps = [],
  onStatusChange,
  onTagsChange,
  onRoadmapAdd,
  onRoadmapRemove,
  isUpdating = false,
  hideSubscribe = false,
  hideVote = false,
}: MetadataSidebarProps) {
  const [tagOpen, setTagOpen] = useState(false)
  const [roadmapOpen, setRoadmapOpen] = useState(false)
  const [pendingRoadmapId, setPendingRoadmapId] = useState<string | null>(null)

  // Fetch subscription status for the bell (only in portal mode)
  const { data: sidebarData } = useQuery({
    ...portalDetailQueries.voteSidebarData(postId),
    // Skip this query in admin mode where we don't need subscription data
    enabled: !hideSubscribe,
  })

  const isMember = sidebarData?.isMember ?? false
  const subscriptionStatus = sidebarData?.subscriptionStatus ?? {
    subscribed: false,
    level: 'none' as const,
    reason: null,
  }

  // Computed values for admin mode
  const currentStatus =
    canEdit && allStatuses.length > 0 ? allStatuses.find((s) => s.id === status?.id) : undefined
  const availableTags = allTags.filter((t) => !tags.some((pt) => pt.id === t.id))
  const currentRoadmapIds = roadmaps.map((r) => r.id)
  const availableRoadmaps = allRoadmaps.filter((r) => !currentRoadmapIds.includes(r.id))

  // Handlers for admin mode
  async function handleTagToggle(tagId: TagId) {
    if (!onTagsChange) return
    const currentTagIds = tags.map((t) => t.id as TagId)
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId]
    await onTagsChange(newTagIds)
  }

  async function handleAddTag(tagId: TagId) {
    if (!onTagsChange) return
    const currentTagIds = tags.map((t) => t.id as TagId)
    if (!currentTagIds.includes(tagId)) {
      await onTagsChange([...currentTagIds, tagId])
    }
    setTagOpen(false)
  }

  async function handleAddToRoadmap(roadmapId: RoadmapId) {
    if (!onRoadmapAdd) return
    setPendingRoadmapId(roadmapId)
    try {
      await onRoadmapAdd(roadmapId)
    } finally {
      setPendingRoadmapId(null)
      setRoadmapOpen(false)
    }
  }

  async function handleRemoveFromRoadmap(roadmapId: RoadmapId) {
    if (!onRoadmapRemove) return
    setPendingRoadmapId(roadmapId)
    try {
      await onRoadmapRemove(roadmapId)
    } finally {
      setPendingRoadmapId(null)
    }
  }

  return (
    <aside
      className="hidden lg:block w-72 shrink-0 border-l border-border/30 bg-muted/5 animate-in fade-in duration-200 fill-mode-backwards"
      style={{ animationDelay: '100ms' }}
    >
      <div className="p-4 space-y-5">
        {/* Upvotes */}
        {!hideVote && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ChevronUpIcon className="h-4 w-4" />
              <span>Upvotes</span>
            </div>
            {canEdit ? (
              // Admin mode: direct vote button (no auth wrapper needed)
              <VoteButton postId={postId} voteCount={voteCount} compact />
            ) : (
              // Portal mode: interactive vote button with auth
              <AuthVoteButton postId={postId} voteCount={voteCount} disabled={!isMember} compact />
            )}
          </div>
        )}

        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Status</span>
          {canEdit && onStatusChange && allStatuses.length > 0 ? (
            <StatusDropdown
              currentStatus={currentStatus}
              statuses={allStatuses}
              onStatusChange={onStatusChange}
              disabled={isUpdating}
              variant="badge"
            />
          ) : status ? (
            <StatusBadge name={status.name} color={status.color} />
          ) : (
            <NoneLabel />
          )}
        </div>

        {/* Board */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FolderIcon className="h-4 w-4" />
            <span>Board</span>
          </div>
          <span className="text-sm font-medium text-foreground">{board.name}</span>
        </div>

        {/* Tags */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TagIcon className="h-4 w-4" />
            <span>Tags</span>
          </div>
          {canEdit && onTagsChange ? (
            <div className="flex flex-wrap justify-end gap-1 max-w-[60%]">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleTagToggle(tag.id as TagId)}
                  disabled={isUpdating}
                  className={cn(
                    'group inline-flex items-center gap-0.5 pl-1.5 pr-1 py-0.5',
                    'rounded-full text-[11px] font-medium',
                    'bg-primary/10 text-primary border border-primary/20',
                    'hover:bg-primary/15 hover:border-primary/30',
                    'transition-all duration-150',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {tag.name}
                  <XMarkIcon className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
              {availableTags.length > 0 && (
                <Popover open={tagOpen} onOpenChange={setTagOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={isUpdating}
                      className={cn(
                        'inline-flex items-center gap-0.5 px-1.5 py-0.5',
                        'rounded-full text-[11px] font-medium',
                        'text-muted-foreground/70 hover:text-muted-foreground',
                        'border border-dashed border-border/60 hover:border-border',
                        'hover:bg-muted/40',
                        'transition-all duration-150',
                        'disabled:opacity-50'
                      )}
                    >
                      <PlusIcon className="h-2.5 w-2.5" />
                      Add
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-40 p-1" align="end" sideOffset={4}>
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => handleAddTag(tag.id as TagId)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md',
                            'text-foreground/80 hover:text-foreground hover:bg-muted/60',
                            'transition-all duration-100 text-left font-medium'
                          )}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              {tags.length === 0 && !tagOpen && (
                <span className="text-xs text-muted-foreground/60 italic">None</span>
              )}
            </div>
          ) : tags.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1 max-w-[60%]">
              {tags.map((tag) => (
                <Badge key={tag.id} variant="secondary" className="text-[11px] font-normal">
                  {tag.name}
                </Badge>
              ))}
            </div>
          ) : (
            <NoneLabel />
          )}
        </div>

        {/* Roadmaps */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapIcon className="h-4 w-4" />
            <span>Roadmap</span>
          </div>
          {canEdit && onRoadmapAdd && onRoadmapRemove ? (
            <div className="flex flex-wrap justify-end gap-1 max-w-[60%]">
              {roadmaps.map((roadmap) => {
                const isPending = pendingRoadmapId === roadmap.id
                return (
                  <button
                    key={roadmap.id}
                    type="button"
                    onClick={() => handleRemoveFromRoadmap(roadmap.id as RoadmapId)}
                    disabled={isPending}
                    className={cn(
                      'group inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5',
                      'rounded-md text-[11px] font-medium',
                      'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
                      'hover:bg-blue-500/15 hover:border-blue-500/30',
                      'transition-all duration-150',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    <MapIcon className="h-3 w-3 opacity-70" />
                    <span className="truncate max-w-[100px]">{roadmap.name}</span>
                    {isPending ? (
                      <ArrowPathIcon className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <XMarkIcon className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                )
              })}
              {availableRoadmaps.length > 0 && (
                <Popover open={roadmapOpen} onOpenChange={setRoadmapOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={!!pendingRoadmapId}
                      className={cn(
                        'inline-flex items-center gap-0.5 px-1.5 py-0.5',
                        'rounded-md text-[11px] font-medium',
                        'text-muted-foreground/70 hover:text-muted-foreground',
                        'border border-dashed border-border/60 hover:border-border',
                        'hover:bg-muted/40',
                        'transition-all duration-150',
                        'disabled:opacity-50'
                      )}
                    >
                      <PlusIcon className="h-2.5 w-2.5" />
                      Add
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="end" sideOffset={4}>
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {availableRoadmaps.map((roadmap) => {
                        const isPending = pendingRoadmapId === roadmap.id
                        return (
                          <button
                            key={roadmap.id}
                            type="button"
                            onClick={() => handleAddToRoadmap(roadmap.id as RoadmapId)}
                            disabled={isPending}
                            className={cn(
                              'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md',
                              'text-foreground/80 hover:text-foreground hover:bg-muted/60',
                              'transition-all duration-100 text-left font-medium',
                              'disabled:opacity-50'
                            )}
                          >
                            <MapIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="truncate">{roadmap.name}</span>
                            {isPending && (
                              <ArrowPathIcon className="h-3 w-3 animate-spin ml-auto" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              {roadmaps.length === 0 && !roadmapOpen && (
                <span className="text-xs text-muted-foreground/60 italic">None</span>
              )}
            </div>
          ) : roadmaps.length > 0 ? (
            <div className="flex flex-col items-end gap-1">
              {roadmaps.map((roadmap) => (
                <Link
                  key={roadmap.id}
                  to="/roadmap"
                  className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                >
                  {roadmap.name}
                </Link>
              ))}
            </div>
          ) : (
            <NoneLabel />
          )}
        </div>

        {/* Date */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarIcon className="h-4 w-4" />
            <span>Date</span>
          </div>
          <TimeAgo date={createdAt} className="text-sm text-foreground" />
        </div>

        {/* Author */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserIcon className="h-4 w-4" />
            <span>Author</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              {authorAvatarUrl && (
                <AvatarImage src={authorAvatarUrl} alt={authorName || 'Author'} />
              )}
              <AvatarFallback className="text-[9px]">{getInitials(authorName)}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium text-foreground">{authorName || 'Anonymous'}</span>
          </div>
        </div>

        {/* Subscribe section - hidden in admin mode */}
        {!hideSubscribe && (
          <div className="border-t border-border/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Subscribe</span>
              <AuthSubscriptionBell
                postId={postId}
                initialStatus={subscriptionStatus}
                disabled={!isMember}
              />
            </div>
            <p className="text-xs text-muted-foreground/70 mt-2">
              Get notified when there are updates to this post
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
