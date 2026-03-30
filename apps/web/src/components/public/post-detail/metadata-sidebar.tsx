import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  CalendarIcon,
  ChevronUpIcon,
  FolderIcon,
  LinkIcon,
  MapIcon,
  PlusIcon,
  TagIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'
import { IconGitMerge, IconLock, IconLockOpen, IconTrash, IconRestore } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { portalDetailQueries } from '@/lib/client/queries/portal-detail'
import { StatusDropdown } from '@/components/shared/status-dropdown'
import { StatusBadge } from '@/components/ui/status-badge'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TimeAgo } from '@/components/ui/time-ago'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import { VotersAvatarStack } from '@/components/admin/feedback/voters-avatar-stack'
import { SOURCE_TYPE_LABELS, SourceTypeIcon } from '@/components/admin/feedback/source-type-icon'
import { cn, getInitials } from '@/lib/shared/utils'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import type { PostId, StatusId, TagId, RoadmapId, BoardId } from '@featurepool/ids'

export function MetadataSidebarSkeleton({
  variant = 'column',
}: { variant?: 'column' | 'card' } = {}) {
  const isCard = variant === 'card'
  return (
    <div
      className={cn(
        'hidden lg:block w-72 shrink-0',
        !isCard && 'border-l border-border/30 bg-muted/5 p-4 space-y-5'
      )}
    >
      <div
        className={cn(
          isCard
            ? 'mt-6 mr-4 ml-1 rounded-xl border border-border/20 bg-card shadow-sm p-4 space-y-5'
            : 'contents'
        )}
      >
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
    </div>
  )
}

function NoneLabel() {
  return <span className="text-sm italic text-muted-foreground">Nenhum</span>
}

export interface MetadataSidebarManageActions {
  onMergeOthers: () => void
  onMergeInto: () => void
  onToggleLock: () => void
  isCommentsLocked: boolean
  isLockPending: boolean
  onDelete: () => void
  onRestore: () => void
  isDeleted: boolean
  isRestorePending: boolean
  isMerged: boolean
  hasDuplicateSignals: boolean
}

interface ManagePostActionsProps {
  actions: MetadataSidebarManageActions
  showLabel?: boolean
  className?: string
}

export function ManagePostActions({
  actions,
  showLabel = true,
  className,
}: ManagePostActionsProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      {showLabel ? (
        <span className="text-sm text-muted-foreground">Gerenciar</span>
      ) : (
        <span className="sr-only">Gerenciar post</span>
      )}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-0.5">
          {!actions.isMerged && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="relative flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <IconGitMerge className="h-5 w-5" strokeWidth={1.5} />
                      {actions.hasDuplicateSignals && (
                        <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Mesclar</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={actions.onMergeOthers}>Mesclar neste</DropdownMenuItem>
                <DropdownMenuItem onClick={actions.onMergeInto}>
                  Mesclar em outro...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={actions.onToggleLock}
                disabled={actions.isLockPending}
                className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
              >
                {actions.isCommentsLocked ? (
                  <IconLock className="h-5 w-5" strokeWidth={1.5} />
                ) : (
                  <IconLockOpen className="h-5 w-5" strokeWidth={1.5} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {actions.isCommentsLocked ? 'Desbloquear comentários' : 'Bloquear comentários'}
            </TooltipContent>
          </Tooltip>

          {actions.isDeleted ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={actions.onRestore}
                  disabled={actions.isRestorePending}
                  className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
                >
                  <IconRestore className="h-5 w-5" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Restaurar post</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={actions.onDelete}
                  className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted/60 transition-colors"
                >
                  <IconTrash className="h-5 w-5" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Excluir post</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    </div>
  )
}

interface MetadataSidebarProps {
  postId: PostId
  voteCount: number
  status?: { id: string; name: string; color: string | null } | null
  board: { id: string; name: string; slug: string }
  authorName: string | null
  authorAvatarUrl?: string | null
  /** Principal ID of the author (used to link to admin user detail) */
  authorPrincipalId?: string | null
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
  /** All available boards for selection */
  allBoards?: Array<{ id: string; name: string; slug: string }>
  /** Callback when board changes */
  onBoardChange?: (boardId: BoardId) => Promise<void>
  /** Whether metadata update is in progress */
  isUpdating?: boolean
  /** Hide subscribe section (for admin context) */
  hideSubscribe?: boolean
  /** Hide vote button (for admin context where voting is handled differently) */
  hideVote?: boolean
  /** Visual variant: 'column' (default border-l) or 'card' (floating card) */
  variant?: 'column' | 'card'
  /** Additional post IDs whose voters should be merged (e.g. for merge preview) */
  votersAdditionalPostIds?: PostId[]
  /** Hide subscription controls in voters modal */
  votersReadonly?: boolean
  /** Admin manage actions (renders icon row at top of sidebar) */
  manageActions?: MetadataSidebarManageActions
  /** Feedback source info (if post was created from the feedback pipeline) */
  feedbackSource?: {
    sourceType: string
    authorName: string | null
    quote: string
    externalUrl: string | null
    createdAt: string
  } | null
}

export function MetadataSidebar({
  postId,
  voteCount,
  status,
  board,
  authorName,
  authorAvatarUrl,
  authorPrincipalId,
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
  allBoards,
  onBoardChange,
  isUpdating = false,
  hideSubscribe = false,
  hideVote = false,
  variant = 'column',
  votersAdditionalPostIds,
  votersReadonly = false,
  manageActions,
  feedbackSource,
}: MetadataSidebarProps) {
  const [tagOpen, setTagOpen] = useState(false)
  const [roadmapOpen, setRoadmapOpen] = useState(false)
  const [boardOpen, setBoardOpen] = useState(false)
  const [sourceQuoteOpen, setSourceQuoteOpen] = useState(false)
  const [pendingRoadmapId, setPendingRoadmapId] = useState<string | null>(null)

  // Fetch subscription status for the bell (only in portal mode)
  const { data: sidebarData } = useQuery({
    ...portalDetailQueries.voteSidebarData(postId),
    // Skip this query in admin mode where we don't need subscription data
    enabled: !hideSubscribe,
  })

  const isMember = sidebarData?.isMember ?? false
  const canVote = sidebarData?.canVote ?? false
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

  async function handleBoardChange(boardId: BoardId) {
    if (!onBoardChange || boardId === (board.id as BoardId)) {
      setBoardOpen(false)
      return
    }
    try {
      await onBoardChange(boardId)
    } finally {
      setBoardOpen(false)
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

  const isCard = variant === 'card'

  return (
    <aside
      className={cn(
        'hidden lg:block w-72 shrink-0 animate-in fade-in duration-200 fill-mode-backwards',
        !isCard && 'border-l border-border/30 bg-muted/5'
      )}
      style={{ animationDelay: '100ms' }}
    >
      <div
        className={cn(
          'p-4 space-y-5',
          isCard && 'mt-6 mr-4 ml-1 rounded-xl border border-border/20 bg-card shadow-sm'
        )}
      >
        {/* Manage Post actions */}
        {manageActions && <ManagePostActions actions={manageActions} />}

        {manageActions && <div className="border-t border-border/30" />}

        {/* Upvotes */}
        {!hideVote &&
          (canEdit ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ChevronUpIcon className="h-4 w-4" />
                  <span>Votos</span>
                </div>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {voteCount}
                </span>
              </div>
              <VotersAvatarStack
                postId={postId}
                voteCount={voteCount}
                votersAdditionalPostIds={votersAdditionalPostIds}
                votersReadonly={votersReadonly}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ChevronUpIcon className="h-4 w-4" />
                <span>Votos</span>
              </div>
              {/* Portal mode: interactive vote button with auth */}
              <AuthVoteButton
                postId={postId}
                voteCount={voteCount}
                disabled={!canVote}
                canVote={canVote}
                compact
              />
            </div>
          ))}

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
            <span>Quadro</span>
          </div>
          {canEdit && onBoardChange && allBoards && allBoards.length > 0 ? (
            <Popover open={boardOpen} onOpenChange={setBoardOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isUpdating}
                  className={cn(
                    'text-sm font-medium text-foreground',
                    'hover:text-primary transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {board.name}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="end" sideOffset={4}>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {allBoards.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleBoardChange(b.id as BoardId)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md',
                        'text-foreground/80 hover:text-foreground hover:bg-muted/60',
                        'transition-all duration-100 text-left font-medium'
                      )}
                    >
                      <FolderIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{b.name}</span>
                      {b.id === board.id && (
                        <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-sm font-medium text-foreground">{board.name}</span>
          )}
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
                      Adicionar
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
              {tags.length === 0 && availableTags.length === 0 && !tagOpen && (
                <span className="text-xs text-muted-foreground/60">-</span>
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
            <span className="text-xs text-muted-foreground/60">-</span>
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
                      Adicionar
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
              {roadmaps.length === 0 && availableRoadmaps.length === 0 && !roadmapOpen && (
                <span className="text-xs text-muted-foreground/60">-</span>
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
            <span className="text-xs text-muted-foreground/60">-</span>
          )}
        </div>

        {/* Date */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarIcon className="h-4 w-4" />
            <span>Data</span>
          </div>
          <TimeAgo date={createdAt} className="text-sm text-foreground" />
        </div>

        {/* Source (only for posts created from the feedback pipeline) */}
        {feedbackSource && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LinkIcon className="h-4 w-4" />
                <span>Origem</span>
              </div>
              <button
                type="button"
                onClick={() => setSourceQuoteOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <SourceTypeIcon sourceType={feedbackSource.sourceType} size="xs" />
                <span>
                  {SOURCE_TYPE_LABELS[feedbackSource.sourceType] ?? feedbackSource.sourceType}
                </span>
              </button>
            </div>
            <Dialog open={sourceQuoteOpen} onOpenChange={setSourceQuoteOpen}>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <SourceTypeIcon sourceType={feedbackSource.sourceType} size="sm" />
                    Feedback original
                  </DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-[50vh] -mx-6 px-6">
                  <blockquote className="border-l-2 border-muted-foreground/20 pl-3 text-sm text-muted-foreground/70 italic leading-relaxed whitespace-pre-wrap">
                    {feedbackSource.quote}
                  </blockquote>
                </ScrollArea>
                <div className="space-y-2 pt-3 border-t border-border/30">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{feedbackSource.authorName ?? 'Autor desconhecido'}</span>
                    <TimeAgo date={feedbackSource.createdAt} />
                  </div>
                  {feedbackSource.externalUrl && (
                    <a
                      href={feedbackSource.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <SourceTypeIcon sourceType={feedbackSource.sourceType} size="xs" />
                      Abrir em{' '}
                      {SOURCE_TYPE_LABELS[feedbackSource.sourceType] ?? feedbackSource.sourceType}
                      <span aria-hidden>&rarr;</span>
                    </a>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* Author */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserIcon className="h-4 w-4" />
            <span>Autor</span>
          </div>
          {canEdit && authorPrincipalId ? (
            <Link
              to="/admin/users"
              search={{ selected: authorPrincipalId }}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <Avatar className="h-5 w-5">
                {authorAvatarUrl && (
                  <AvatarImage src={authorAvatarUrl} alt={authorName || 'Autor'} />
                )}
                <AvatarFallback className="text-[9px]">{getInitials(authorName)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground underline decoration-muted-foreground/30 underline-offset-2">
                {authorName || 'Anônimo'}
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-1.5">
              <Avatar className="h-5 w-5">
                {authorAvatarUrl && (
                  <AvatarImage src={authorAvatarUrl} alt={authorName || 'Autor'} />
                )}
                <AvatarFallback className="text-[9px]">{getInitials(authorName)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground">{authorName || 'Anônimo'}</span>
            </div>
          )}
        </div>

        {/* Subscribe section - hidden in admin mode */}
        {!hideSubscribe && (
          <div className="border-t border-border/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Inscrever-se</span>
              <AuthSubscriptionBell
                postId={postId}
                initialStatus={subscriptionStatus}
                disabled={!isMember}
              />
            </div>
            <p className="text-xs text-muted-foreground/70 mt-2">
              Receba notificações quando houver atualizações neste post
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
