import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ChatBubbleLeftIcon,
  HandThumbUpIcon,
  ArrowPathIcon,
  CalendarIcon,
  UserIcon,
  TrashIcon,
  ChevronUpIcon,
  PencilSquareIcon,
  Squares2X2Icon,
  PencilIcon,
  XMarkIcon,
  CheckIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import { contentPreview } from '@/lib/shared/utils/string'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { TimeAgo } from '@/components/ui/time-ago'
import type { PortalUserDetail, EngagedPost } from '@/lib/server/domains/users'
import { UserSegmentBadges } from '@/components/admin/users/user-segments'
import { useUpdatePortalUser } from '@/lib/client/mutations'
import type { PrincipalId } from '@quackback/ids'

interface UserDetailProps {
  user: PortalUserDetail | null
  isLoading: boolean
  onClose: () => void
  onRemoveUser: () => void
  isRemovePending: boolean
  currentMemberRole: string
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function formatDate(date: Date | string): string {
  return dateFormatter.format(new Date(date))
}

function DetailSkeleton() {
  return (
    <div className="p-4 space-y-6">
      {/* Profile Header */}
      <div className="flex items-start gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-6 w-40 mb-2" />
          <Skeleton className="h-4 w-48 mb-2" />
          <Skeleton className="h-5 w-20 rounded-md" />
        </div>
      </div>

      {/* Activity Stats (3-column grid) */}
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>

      {/* Activity section */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-16" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}

function EmptyMessage({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function EngagementBadges({ types }: { types: EngagedPost['engagementTypes'] }) {
  return (
    <div className="flex items-center gap-1">
      {types.includes('authored') && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary"
          title="Authored this post"
        >
          <PencilSquareIcon className="h-2.5 w-2.5" />
        </span>
      )}
      {types.includes('commented') && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400"
          title="Commented on this post"
        >
          <ChatBubbleLeftIcon className="h-2.5 w-2.5" />
        </span>
      )}
      {types.includes('voted') && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400"
          title="Voted on this post"
        >
          <HandThumbUpIcon className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  )
}

function EngagedPostCard({ post }: { post: EngagedPost }) {
  return (
    <Link
      to="/b/$slug/posts/$postId"
      params={{ slug: post.boardSlug, postId: post.id }}
      className="flex transition-colors hover:bg-muted/30 border-b border-border/30 last:border-b-0"
    >
      {/* Vote section - left column */}
      <div className="flex flex-col items-center justify-center w-14 shrink-0 border-r border-border/30 py-3">
        <ChevronUpIcon className="h-5 w-5 text-muted-foreground" />
        <span className="text-xs font-bold text-foreground">{post.voteCount}</span>
      </div>

      {/* Content section */}
      <div className="flex-1 min-w-0 px-3 py-2.5">
        {/* Status and engagement badges row */}
        <div className="flex items-center gap-2 mb-1.5">
          {post.statusName && <StatusBadge name={post.statusName} color={post.statusColor} />}
          <EngagementBadges types={post.engagementTypes} />
        </div>

        {/* Title */}
        <h4 className="font-medium text-sm text-foreground line-clamp-1 mb-0.5">{post.title}</h4>

        {/* Description */}
        <p className="text-xs text-muted-foreground/80 line-clamp-2 mb-2">
          {contentPreview(post.content)}
        </p>

        {/* Footer */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="text-foreground/70">{post.authorName || 'Anonymous'}</span>
          <span className="text-muted-foreground/50">·</span>
          <TimeAgo date={new Date(post.createdAt)} />
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-muted-foreground/70">
            <ChatBubbleLeftIcon className="h-3 w-3" />
            <span>{post.commentCount}</span>
          </div>
          <Badge
            variant="secondary"
            className="text-[10px] font-normal bg-muted/50 px-1.5 py-0 inline-flex items-center gap-0.5"
          >
            <Squares2X2Icon className="h-2.5 w-2.5 text-muted-foreground/40" />
            {post.boardName}
          </Badge>
        </div>
      </div>
    </Link>
  )
}

export function UserDetail({
  user,
  isLoading,
  onClose,
  onRemoveUser,
  isRemovePending,
  currentMemberRole,
}: UserDetailProps) {
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const updateUser = useUpdatePortalUser()
  // Check if current user can manage portal users
  const canManageUsers = currentMemberRole === 'admin'

  const startEditing = () => {
    if (!user) return
    setEditName(user.name || '')
    setEditEmail(user.email || '')
    setIsEditing(true)
  }

  const cancelEditing = () => {
    setIsEditing(false)
  }

  const saveEdits = () => {
    if (!user) return
    const updates: { principalId: string; name?: string; email?: string | null } = {
      principalId: user.principalId,
    }
    const trimmedName = editName.trim()
    const trimmedEmail = editEmail.trim()

    if (trimmedName && trimmedName !== (user.name || '')) {
      updates.name = trimmedName
    }
    const newEmail = trimmedEmail || null
    if (newEmail !== (user.email || null)) {
      updates.email = newEmail
    }

    if (!updates.name && updates.email === undefined) {
      setIsEditing(false)
      return
    }

    updateUser.mutate(updates, {
      onSuccess: () => {
        setIsEditing(false)
        toast.success('User updated')
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to update user')
      },
    })
  }

  const backHeader = (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5">
      <Button variant="ghost" size="sm" onClick={onClose}>
        <ArrowLeftIcon className="h-4 w-4 mr-1.5" />
        Back to users
      </Button>
    </div>
  )

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto w-full">
        {backHeader}
        <DetailSkeleton />
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="max-w-5xl mx-auto w-full">
      {backHeader}
      <div className="p-4 space-y-6">
        {/* Profile Header */}
        <div className="flex items-start gap-4">
          <Avatar src={user.image} name={user.name} className="h-16 w-16" />
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Name"
                  className="text-sm"
                />
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="text-sm"
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={saveEdits}
                    disabled={updateUser.isPending}
                  >
                    {updateUser.isPending ? (
                      <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckIcon className="h-3.5 w-3.5 mr-1" />
                    )}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEditing}>
                    <XMarkIcon className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-lg truncate">{user.name || 'Unnamed User'}</h2>
                  {user.emailVerified && (
                    <CheckCircleIcon className="h-4 w-4 text-primary shrink-0" />
                  )}
                  {canManageUsers && (
                    <button
                      type="button"
                      onClick={startEditing}
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      title="Edit user details"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {user.email ? (
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                ) : (
                  <p className="text-sm text-muted-foreground/50 italic">No email</p>
                )}
                <Badge variant="secondary" className="mt-2 text-xs">
                  Portal User
                </Badge>
              </>
            )}
          </div>
        </div>

        {/* Activity Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <DocumentTextIcon className="h-4 w-4" />
            </div>
            <div className="text-2xl font-semibold">{user.postCount}</div>
            <div className="text-xs text-muted-foreground">Posts</div>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <ChatBubbleLeftIcon className="h-4 w-4" />
            </div>
            <div className="text-2xl font-semibold">{user.commentCount}</div>
            <div className="text-xs text-muted-foreground">Comments</div>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
              <HandThumbUpIcon className="h-4 w-4" />
            </div>
            <div className="text-2xl font-semibold">{user.voteCount}</div>
            <div className="text-xs text-muted-foreground">Votes</div>
          </div>
        </div>

        {/* User Attributes */}
        {user.metadata &&
          (() => {
            try {
              const attrs = JSON.parse(user.metadata as string) as Record<string, unknown>
              const entries = Object.entries(attrs).filter(([key]) => !key.startsWith('_'))
              if (entries.length === 0) return null
              return (
                <div className="border-t border-border/50 pt-4">
                  <h3 className="text-sm font-medium mb-3">Attributes</h3>
                  <div className="space-y-1.5">
                    {entries.map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="font-mono text-xs truncate max-w-[60%] text-right">
                          {value === null ? (
                            <span className="text-muted-foreground/50 italic">null</span>
                          ) : (
                            String(value)
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            } catch {
              return null
            }
          })()}

        {/* Segments */}
        {(user.segments.length > 0 || canManageUsers) && (
          <div className="border-t border-border/50 pt-4">
            <h3 className="text-sm font-medium mb-3">Segments</h3>
            <UserSegmentBadges
              principalId={user.principalId as PrincipalId}
              segments={user.segments}
              canManage={canManageUsers}
            />
          </div>
        )}

        {/* Engaged Posts */}
        <div>
          <h3 className="text-sm font-medium mb-3">Activity</h3>
          {user.engagedPosts.length === 0 ? (
            <EmptyMessage message="No activity yet" />
          ) : (
            <div className="border border-border/50 rounded-lg overflow-hidden">
              {user.engagedPosts.map((post) => (
                <EngagedPostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>

        {/* Account Info */}
        <div className="border-t border-border/50 pt-4">
          <h3 className="text-sm font-medium mb-3">Account</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarIcon className="h-4 w-4" />
              <span>Joined portal {formatDate(user.joinedAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <UserIcon className="h-4 w-4" />
              <span>Account created {formatDate(user.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        {canManageUsers && (
          <div className="border-t border-border/50 pt-4 space-y-3">
            <h3 className="text-sm font-medium">Actions</h3>

            {/* Remove User */}
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              disabled={isRemovePending}
              onClick={() => setRemoveDialogOpen(true)}
            >
              {isRemovePending ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <TrashIcon className="h-4 w-4 mr-2" />
              )}
              Remove from portal
            </Button>
            <ConfirmDialog
              open={removeDialogOpen}
              onOpenChange={setRemoveDialogOpen}
              title={`Remove ${user.name || 'this user'}?`}
              description="This will remove the user from your portal. They will lose access to vote and comment but their existing activity will remain. Their global account is preserved and they can sign up again."
              confirmLabel="Remove"
              variant="destructive"
              isPending={isRemovePending}
              onConfirm={onRemoveUser}
            />
          </div>
        )}
      </div>
    </div>
  )
}
