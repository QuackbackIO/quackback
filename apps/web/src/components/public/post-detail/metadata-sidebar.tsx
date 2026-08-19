import { useState } from 'react'
import { useIntl, FormattedMessage } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CalendarIcon,
  ChevronUpIcon,
  FolderIcon,
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
import { portalDetailQueries } from '@/lib/client/queries/portal-detail'
import { StatusDropdown } from '@/components/shared/status-dropdown'
import { StatusBadge } from '@/components/ui/status-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TimeAgo } from '@/components/ui/time-ago'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { AuthorHoverCard } from '@/components/public/author-hover-card'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import {
  VotersAvatarStack,
  type VotersQuerySource,
} from '@/components/admin/feedback/voters-avatar-stack'
import { cn, getInitials, formatMonthYear } from '@/lib/shared/utils'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import type { OwnerRef } from '@/lib/server/functions/post-owner-context'
import type { PostId, PostStatusId, PostTagId, BoardId, PrincipalId } from '@quackback/ids'

export function MetadataSidebarSkeleton({
  variant = 'column',
}: { variant?: 'column' | 'card' } = {}) {
  const isCard = variant === 'card'
  return (
    <div
      className={cn(
        'hidden lg:block w-72 shrink-0',
        !isCard && 'border-s border-border/30 bg-muted/5 p-4 space-y-5'
      )}
    >
      <div
        className={cn(
          isCard
            ? 'mt-6 me-4 ms-1 rounded-xl border border-border/20 bg-card shadow-sm p-4 space-y-5'
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
  return <span className="text-sm italic text-muted-foreground">None</span>
}

/**
 * Manage-row actions. Every group is optional: a group's controls render only
 * when its callbacks are provided, so callers can expose exactly the actions
 * the actor is permitted to perform (the admin modal passes everything).
 */
export interface MetadataSidebarManageActions {
  onMergeOthers?: () => void
  onMergeInto?: () => void
  onToggleLock?: () => void
  isCommentsLocked?: boolean
  isLockPending?: boolean
  onDelete?: () => void
  onRestore?: () => void
  isDeleted?: boolean
  isRestorePending?: boolean
  isMerged?: boolean
  hasDuplicateSignals?: boolean
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
  const intl = useIntl()

  return (
    <div className={cn('flex items-center justify-between', className)}>
      {showLabel ? (
        <span className="text-sm text-muted-foreground">
          <FormattedMessage id="portal.postDetail.metadata.manage" defaultMessage="Manage" />
        </span>
      ) : (
        <span className="sr-only">
          {intl.formatMessage({
            id: 'portal.postDetail.metadata.managePost',
            defaultMessage: 'Manage post',
          })}
        </span>
      )}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-0.5">
          {!actions.isMerged && actions.onMergeOthers && actions.onMergeInto && (
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
                <TooltipContent side="bottom">
                  {intl.formatMessage({
                    id: 'portal.postDetail.metadata.merge',
                    defaultMessage: 'Merge',
                  })}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={actions.onMergeOthers}>
                  <FormattedMessage
                    id="portal.postDetail.metadata.mergeIntoThis"
                    defaultMessage="Merge into this"
                  />
                </DropdownMenuItem>
                <DropdownMenuItem onClick={actions.onMergeInto}>
                  <FormattedMessage
                    id="portal.postDetail.metadata.mergeIntoAnother"
                    defaultMessage="Merge into another..."
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {actions.onToggleLock && (
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
                {actions.isCommentsLocked
                  ? intl.formatMessage({
                      id: 'portal.postDetail.metadata.unlockComments',
                      defaultMessage: 'Unlock comments',
                    })
                  : intl.formatMessage({
                      id: 'portal.postDetail.metadata.lockComments',
                      defaultMessage: 'Lock comments',
                    })}
              </TooltipContent>
            </Tooltip>
          )}

          {actions.isDeleted && actions.onRestore ? (
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
              <TooltipContent side="bottom">
                {intl.formatMessage({
                  id: 'portal.postDetail.metadata.restorePost',
                  defaultMessage: 'Restore post',
                })}
              </TooltipContent>
            </Tooltip>
          ) : !actions.isDeleted && actions.onDelete ? (
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
              <TooltipContent side="bottom">
                {intl.formatMessage({
                  id: 'portal.postDetail.metadata.deletePost',
                  defaultMessage: 'Delete post',
                })}
              </TooltipContent>
            </Tooltip>
          ) : null}
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
  /** Target ship date (time-based roadmap); rendered as a "Mar 2027" chip. */
  eta?: Date | string | null
  tags?: Array<{ id: string; name: string; color: string }>

  // Team/admin mode props (all optional). Each metadata editor renders iff its
  // callback (and any option list it needs) is provided, so callers can enable
  // exactly the editors the actor is permitted to use.
  /** Enable admin-only ambient sections (voters stack, author link to admin) */
  canEdit?: boolean
  /** All available statuses for dropdown */
  allStatuses?: PostStatusEntity[]
  /** All available tags for selection */
  allTags?: Array<{ id: string; name: string; color: string }>
  /** Callback when status changes */
  onStatusChange?: (statusId: PostStatusId) => Promise<void>
  /** Callback when the ETA is set (ISO string) or cleared (null) */
  onEtaChange?: (eta: string | null) => Promise<void>
  /** Callback when tags change */
  onTagsChange?: (tagIds: PostTagId[]) => Promise<void>
  /** All available boards for selection */
  allBoards?: Array<{ id: string; name: string; slug: string }>
  /** Callback when board changes */
  onBoardChange?: (boardId: BoardId) => Promise<void>
  /** Current post owner (assignee); null when unassigned */
  owner?: OwnerRef | null
  /** Team members assignable as owner (for the picker) */
  ownerCandidates?: OwnerRef[]
  /** Callback when the owner is set (principal id) or cleared (null) */
  onOwnerChange?: (ownerId: PrincipalId | null) => Promise<void>
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
  /**
   * Render the voters avatar stack + modal (the vote-management tools). The
   * admin modal passes this in its canEdit context; the portal passes it for
   * holders of post.vote_on_behalf. Independent of `canEdit` so the tools can
   * appear on the portal without the admin ambient sections.
   */
  showVoters?: boolean
  /**
   * Where the voters list is read from (defaults to the admin query inside the
   * stack). The portal passes its post.vote_on_behalf-gated source.
   */
  votersQuery?: VotersQuerySource
  /** Gate the add-voter member search (people.view). Defaults true. */
  votersCanAddVoter?: boolean
  /** Gate the create-new-user add-voter branch (people.manage). Defaults true. */
  votersCanCreateUser?: boolean
  /** Extra invalidation after a vote-management mutation (portal query + detail). */
  onVotersInvalidate?: () => void
  /** Admin manage actions (renders icon row at top of sidebar) */
  manageActions?: MetadataSidebarManageActions
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
  eta,
  tags = [],
  canEdit = false,
  allStatuses = [],
  allTags = [],
  onStatusChange,
  onEtaChange,
  onTagsChange,
  allBoards,
  onBoardChange,
  owner = null,
  ownerCandidates = [],
  onOwnerChange,
  isUpdating = false,
  hideSubscribe = false,
  hideVote = false,
  variant = 'column',
  votersAdditionalPostIds,
  votersReadonly = false,
  showVoters = false,
  votersQuery,
  votersCanAddVoter,
  votersCanCreateUser,
  onVotersInvalidate,
  manageActions,
}: MetadataSidebarProps) {
  const intl = useIntl()
  const [tagOpen, setTagOpen] = useState(false)
  const [boardOpen, setBoardOpen] = useState(false)
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [etaOpen, setEtaOpen] = useState(false)

  const etaLabel = formatMonthYear(eta)
  // Month input value ("YYYY-MM"), derived in UTC to match the stored ETA.
  const etaMonthValue = eta ? new Date(eta).toISOString().slice(0, 7) : ''
  const handleEtaChange = async (value: string) => {
    if (!onEtaChange || !value) return
    await onEtaChange(new Date(`${value}-01T00:00:00.000Z`).toISOString())
    setEtaOpen(false)
  }
  const handleEtaClear = async () => {
    if (!onEtaChange) return
    await onEtaChange(null)
    setEtaOpen(false)
  }

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

  // Computed values for team/admin mode
  const currentStatus =
    allStatuses.length > 0 ? allStatuses.find((s) => s.id === status?.id) : undefined
  const availableTags = allTags.filter((t) => !tags.some((pt) => pt.id === t.id))

  // Handlers for admin mode
  async function handleTagToggle(tagId: PostTagId) {
    if (!onTagsChange) return
    const currentTagIds = tags.map((t) => t.id as PostTagId)
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId]
    await onTagsChange(newTagIds)
  }

  async function handleAddTag(tagId: PostTagId) {
    if (!onTagsChange) return
    const currentTagIds = tags.map((t) => t.id as PostTagId)
    if (!currentTagIds.includes(tagId)) {
      await onTagsChange([...currentTagIds, tagId])
    }
    setTagOpen(false)
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

  async function handleOwnerSelect(ownerId: PrincipalId | null) {
    setOwnerOpen(false)
    if (!onOwnerChange || ownerId === (owner?.principalId ?? null)) return
    await onOwnerChange(ownerId)
  }

  const isCard = variant === 'card'

  return (
    <aside
      className={cn(
        'hidden lg:block w-72 shrink-0 animate-in fade-in duration-200 fill-mode-backwards',
        !isCard && 'border-s border-border/30 bg-muted/5'
      )}
      style={{ animationDelay: '100ms' }}
    >
      <div
        className={cn(
          'p-4 space-y-5',
          isCard && 'mt-6 me-4 ms-1 rounded-xl border border-border/20 bg-card shadow-sm'
        )}
      >
        {/* Manage Post actions */}
        {manageActions && <ManagePostActions actions={manageActions} />}

        {manageActions && <div className="border-t border-border/30" />}

        {/* Upvotes. The voters avatar stack renders under either header when
            showVoters is set — the admin modal always passes it; the portal
            passes it for holders of post.vote_on_behalf. */}
        {!hideVote &&
          (canEdit ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ChevronUpIcon className="h-4 w-4" />
                  <span>
                    <FormattedMessage
                      id="portal.postDetail.metadata.upvotes"
                      defaultMessage="Upvotes"
                    />
                  </span>
                </div>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {voteCount}
                </span>
              </div>
              {showVoters && (
                <VotersAvatarStack
                  postId={postId}
                  voteCount={voteCount}
                  votersAdditionalPostIds={votersAdditionalPostIds}
                  votersReadonly={votersReadonly}
                  votersQuery={votersQuery}
                  canAddVoter={votersCanAddVoter}
                  canCreateUser={votersCanCreateUser}
                  onVotersInvalidate={onVotersInvalidate}
                />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ChevronUpIcon className="h-4 w-4" />
                  <span>
                    <FormattedMessage
                      id="portal.postDetail.metadata.upvotes"
                      defaultMessage="Upvotes"
                    />
                  </span>
                </div>
                {/* Portal mode: interactive vote button with auth + authz.
                    Don't structurally disable on !canVote — AuthVoteButton renders
                    the denied state (sign-in prompt or "no access" tooltip). */}
                <AuthVoteButton
                  postId={postId}
                  voteCount={voteCount}
                  canVote={canVote}
                  isAuthenticated={isMember}
                  compact
                />
              </div>
              {showVoters && (
                <VotersAvatarStack
                  postId={postId}
                  voteCount={voteCount}
                  votersAdditionalPostIds={votersAdditionalPostIds}
                  votersReadonly={votersReadonly}
                  votersQuery={votersQuery}
                  canAddVoter={votersCanAddVoter}
                  canCreateUser={votersCanCreateUser}
                  onVotersInvalidate={onVotersInvalidate}
                />
              )}
            </div>
          ))}

        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            <FormattedMessage id="portal.postDetail.metadata.status" defaultMessage="Status" />
          </span>
          {onStatusChange && allStatuses.length > 0 ? (
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

        {/* ETA (time-based roadmap). Read: a "Mar 2027" chip; editor: month picker. */}
        {(onEtaChange || etaLabel) && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarIcon className="h-4 w-4" />
              <span>
                <FormattedMessage id="portal.postDetail.metadata.eta" defaultMessage="ETA" />
              </span>
            </div>
            {onEtaChange ? (
              <Popover open={etaOpen} onOpenChange={setEtaOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={isUpdating}
                    className={cn(
                      'text-sm font-medium text-end',
                      etaLabel ? 'text-foreground' : 'text-muted-foreground/70',
                      'hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {etaLabel ??
                      intl.formatMessage({
                        id: 'portal.postDetail.metadata.setEta',
                        defaultMessage: 'Set ETA',
                      })}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2 space-y-2" align="end" sideOffset={4}>
                  <input
                    type="month"
                    value={etaMonthValue}
                    disabled={isUpdating}
                    onChange={(e) => handleEtaChange(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                    aria-label={intl.formatMessage({
                      id: 'portal.postDetail.metadata.eta',
                      defaultMessage: 'ETA',
                    })}
                  />
                  {etaLabel && (
                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={handleEtaClear}
                      className="w-full text-start text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <FormattedMessage
                        id="portal.postDetail.metadata.clearEta"
                        defaultMessage="Clear ETA"
                      />
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            ) : etaLabel ? (
              <span className="text-sm font-medium text-foreground text-end">{etaLabel}</span>
            ) : null}
          </div>
        )}

        {/* Board */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FolderIcon className="h-4 w-4" />
            <span>
              <FormattedMessage id="portal.postDetail.metadata.board" defaultMessage="Board" />
            </span>
          </div>
          {onBoardChange && allBoards && allBoards.length > 0 ? (
            <Popover open={boardOpen} onOpenChange={setBoardOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isUpdating}
                  className={cn(
                    'text-sm font-medium text-foreground text-end max-w-[60%]',
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
                        'transition-all duration-100 text-start font-medium'
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
            <span className="text-sm font-medium text-foreground text-end max-w-[60%]">
              {board.name}
            </span>
          )}
        </div>

        {/* Owner (assignee) — renders only when the actor can set the owner. */}
        {onOwnerChange && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <UserIcon className="h-4 w-4" />
              <span>
                <FormattedMessage id="portal.postDetail.metadata.owner" defaultMessage="Owner" />
              </span>
            </div>
            <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isUpdating}
                  className={cn(
                    'flex items-center gap-1.5 text-sm font-medium text-end max-w-[60%]',
                    'hover:opacity-80 transition-opacity',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {owner ? (
                    <>
                      <Avatar className="h-5 w-5">
                        {owner.avatarUrl && <AvatarImage src={owner.avatarUrl} alt={owner.name} />}
                        <AvatarFallback className="text-xs">
                          {getInitials(owner.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-foreground">{owner.name}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground/70">
                      <FormattedMessage
                        id="portal.postDetail.metadata.ownerUnassigned"
                        defaultMessage="Unassigned"
                      />
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-1" align="end" sideOffset={4}>
                <ScrollArea
                  className="[&_[data-slot=scroll-area-viewport]]:max-h-56"
                  scrollBarClassName="w-1.5"
                >
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => handleOwnerSelect(null)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md',
                        'text-foreground/80 hover:text-foreground hover:bg-muted/60',
                        'transition-all duration-100 text-start font-medium'
                      )}
                    >
                      <UserIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">
                        <FormattedMessage
                          id="portal.postDetail.metadata.ownerUnassigned"
                          defaultMessage="Unassigned"
                        />
                      </span>
                      {!owner && <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>
                    {ownerCandidates.map((m) => (
                      <button
                        key={m.principalId}
                        type="button"
                        onClick={() => handleOwnerSelect(m.principalId as PrincipalId)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md',
                          'text-foreground/80 hover:text-foreground hover:bg-muted/60',
                          'transition-all duration-100 text-start font-medium'
                        )}
                      >
                        <Avatar className="h-5 w-5 shrink-0">
                          {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.name} />}
                          <AvatarFallback className="text-xs">{getInitials(m.name)}</AvatarFallback>
                        </Avatar>
                        <span className="flex-1 truncate">{m.name}</span>
                        {owner?.principalId === m.principalId && (
                          <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Tags */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TagIcon className="h-4 w-4" />
            <span>
              <FormattedMessage id="portal.postDetail.metadata.tags" defaultMessage="Tags" />
            </span>
          </div>
          {onTagsChange ? (
            <div className="flex flex-wrap justify-end gap-1 max-w-[60%]">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleTagToggle(tag.id as PostTagId)}
                  disabled={isUpdating}
                  className={cn(
                    'group inline-flex items-center gap-0.5 ps-1.5 pe-1 py-0.5',
                    'rounded-full text-[11px] font-medium border',
                    'hover:opacity-80',
                    'transition-all duration-150',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                  style={{
                    backgroundColor: tag.color + '20',
                    borderColor: tag.color + '40',
                    color: tag.color,
                  }}
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
                      <FormattedMessage
                        id="portal.postDetail.metadata.tagAdd"
                        defaultMessage="Add"
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-40 p-1" align="end" sideOffset={4}>
                    <ScrollArea
                      className="[&_[data-slot=scroll-area-viewport]]:max-h-48"
                      scrollBarClassName="w-1.5"
                    >
                      <div className="space-y-0.5">
                        {availableTags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => handleAddTag(tag.id as PostTagId)}
                            className={cn(
                              'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md',
                              'text-foreground/80 hover:text-foreground hover:bg-muted/60',
                              'transition-all duration-100 text-start font-medium'
                            )}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: tag.color }}
                            />
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
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
                <span
                  key={tag.id}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                  style={{
                    backgroundColor: tag.color + '20',
                    color: tag.color,
                  }}
                >
                  {tag.name}
                </span>
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
            <span>
              <FormattedMessage id="portal.postDetail.metadata.date" defaultMessage="Date" />
            </span>
          </div>
          <TimeAgo date={createdAt} className="text-sm text-foreground" />
        </div>

        {/* Author */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserIcon className="h-4 w-4" />
            <span>
              <FormattedMessage id="portal.postDetail.metadata.author" defaultMessage="Author" />
            </span>
          </div>
          {canEdit && authorPrincipalId ? (
            <Link
              to="/admin/users"
              search={{ selected: authorPrincipalId }}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <Avatar className="h-5 w-5">
                {authorAvatarUrl && (
                  <AvatarImage
                    src={authorAvatarUrl}
                    alt={
                      authorName ||
                      intl.formatMessage({
                        id: 'portal.postDetail.metadata.authorFallback',
                        defaultMessage: 'Anonymous',
                      })
                    }
                  />
                )}
                <AvatarFallback className="text-xs">{getInitials(authorName)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground underline decoration-muted-foreground/30 underline-offset-2">
                {authorName ||
                  intl.formatMessage({
                    id: 'portal.postDetail.metadata.authorFallback',
                    defaultMessage: 'Anonymous',
                  })}
              </span>
            </Link>
          ) : (
            (() => {
              const authorRow = (
                <div className="flex items-center gap-1.5">
                  <Avatar className="h-5 w-5">
                    {authorAvatarUrl && (
                      <AvatarImage
                        src={authorAvatarUrl}
                        alt={
                          authorName ||
                          intl.formatMessage({
                            id: 'portal.postDetail.metadata.authorFallback',
                            defaultMessage: 'Anonymous',
                          })
                        }
                      />
                    )}
                    <AvatarFallback className="text-xs">{getInitials(authorName)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium text-foreground">
                    {authorName ||
                      intl.formatMessage({
                        id: 'portal.postDetail.metadata.authorFallback',
                        defaultMessage: 'Anonymous',
                      })}
                  </span>
                </div>
              )
              return authorPrincipalId ? (
                <AuthorHoverCard principalId={authorPrincipalId} displayName={authorName}>
                  {authorRow}
                </AuthorHoverCard>
              ) : (
                authorRow
              )
            })()
          )}
        </div>

        {/* Subscribe section - hidden in admin mode */}
        {!hideSubscribe && (
          <div className="border-t border-border/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                <FormattedMessage
                  id="portal.postDetail.metadata.subscribe"
                  defaultMessage="Subscribe"
                />
              </span>
              <AuthSubscriptionBell
                postId={postId}
                initialStatus={subscriptionStatus}
                disabled={!isMember}
              />
            </div>
            <p className="text-xs text-muted-foreground/70 mt-2">
              <FormattedMessage
                id="portal.postDetail.metadata.subscribeHint"
                defaultMessage="Get notified when there are updates to this post"
              />
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
