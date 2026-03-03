import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { BellIcon, BellSlashIcon } from '@heroicons/react/24/solid'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Avatar } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { SOURCE_TYPE_LABELS, SourceTypeIcon } from '@/components/admin/feedback/source-type-icon'
import { adminQueries } from '@/lib/client/queries/admin'
import { useUpdateVoterSubscription } from '@/lib/client/mutations/admin-subscriptions'
import type { PostId, PrincipalId } from '@quackback/ids'
import type { SubscriptionLevel } from '@/lib/server/domains/subscriptions/subscription.types'

interface VotersModalProps {
  postId: PostId
  voteCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SUBSCRIPTION_LABELS: Record<SubscriptionLevel, string> = {
  all: 'All activity',
  status_only: 'Status only',
  none: 'Not subscribed',
}

export function VotersModal({ postId, voteCount, open, onOpenChange }: VotersModalProps) {
  const { data: voters, isLoading } = useQuery({
    ...adminQueries.postVoters(postId),
    enabled: open,
  })

  const updateSubscription = useUpdateVoterSubscription(postId)

  const summary = useMemo(() => {
    if (!voters) return null
    const total = voters.length
    const statusCount = voters.filter(
      (v) => v.subscriptionLevel === 'all' || v.subscriptionLevel === 'status_only'
    ).length
    const commentCount = voters.filter((v) => v.subscriptionLevel === 'all').length
    return { total, statusCount, commentCount }
  }, [voters])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Voters ({voteCount})</DialogTitle>
        </DialogHeader>
        <div className="max-h-[400px] overflow-y-auto -mx-6 px-6">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : voters && voters.length > 0 ? (
            <div className="space-y-3">
              {voters.map((voter) => {
                const isAnonymous = !voter.email && !voter.displayName
                return (
                  <div key={voter.principalId} className="flex items-center gap-3">
                    <Avatar
                      src={voter.avatarUrl}
                      name={voter.displayName}
                      className="h-8 w-8 text-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {voter.displayName || voter.email || 'Anonymous'}
                      </p>
                      <VoterSourceLine voter={voter} />
                    </div>
                    {isAnonymous ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <SubscriptionBadge
                        level={voter.subscriptionLevel}
                        onChangeLevel={(level) =>
                          updateSubscription.mutate({
                            principalId: voter.principalId as PrincipalId,
                            level,
                          })
                        }
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No voters yet</p>
          )}
        </div>
        {summary && summary.total > 0 && (
          <div className="border-t pt-3 -mx-6 px-6 text-xs text-muted-foreground">
            {summary.statusCount} of {summary.total} voters notified on status change
            {' · '}
            {summary.commentCount} on comments
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SubscriptionBadge({
  level,
  onChangeLevel,
}: {
  level: SubscriptionLevel
  onChangeLevel: (level: SubscriptionLevel) => void
}) {
  const config = {
    all: {
      icon: BellIcon,
      className: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950',
    },
    status_only: {
      icon: BellIcon,
      className: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950',
    },
    none: {
      icon: BellSlashIcon,
      className: 'text-muted-foreground bg-muted',
    },
  }[level]

  const Icon = config.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 cursor-pointer transition-opacity hover:opacity-80 ${config.className}`}
        >
          <Icon className="h-3 w-3" />
          <span>{SUBSCRIPTION_LABELS[level]}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={level}
          onValueChange={(v) => onChangeLevel(v as SubscriptionLevel)}
        >
          {(Object.entries(SUBSCRIPTION_LABELS) as Array<[SubscriptionLevel, string]>).map(
            ([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            )
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function VoterSourceLine({
  voter,
}: {
  voter: {
    sourceType: string | null
    sourceExternalUrl: string | null
    createdAt: string
  }
}) {
  if (voter.sourceType && voter.sourceExternalUrl) {
    const platformName = SOURCE_TYPE_LABELS[voter.sourceType] ?? capitalize(voter.sourceType)
    return (
      <a
        href={voter.sourceExternalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <SourceTypeIcon sourceType={voter.sourceType} size="xs" />
        <span>via {platformName}</span>
        <ArrowTopRightOnSquareIcon className="h-3 w-3" />
      </a>
    )
  }

  if (voter.sourceType) {
    const platformName = SOURCE_TYPE_LABELS[voter.sourceType] ?? capitalize(voter.sourceType)
    return (
      <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <SourceTypeIcon sourceType={voter.sourceType} size="xs" />
        <span>via {platformName}</span>
      </p>
    )
  }

  return <TimeAgo date={voter.createdAt} className="text-xs text-muted-foreground" />
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
