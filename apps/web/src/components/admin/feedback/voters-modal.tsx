import { useQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Avatar } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import { Skeleton } from '@/components/ui/skeleton'
import { SOURCE_TYPE_LABELS, SourceTypeIcon } from '@/components/admin/feedback/source-type-icon'
import { adminQueries } from '@/lib/client/queries/admin'
import type { PostId } from '@quackback/ids'

interface VotersModalProps {
  postId: PostId
  voteCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VotersModal({ postId, voteCount, open, onOpenChange }: VotersModalProps) {
  const { data: voters, isLoading } = useQuery({
    ...adminQueries.postVoters(postId),
    enabled: open,
  })

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
              {voters.map((voter) => (
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
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No voters yet</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
