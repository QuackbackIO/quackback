/**
 * Possible-duplicates warning on a portal person's profile.
 *
 * Flags other principals that share an address or carry a near-identical
 * display name, and gives the admin the merge entry point: a lead match can
 * be folded into the profile being viewed (merge direction is strictly
 * lead → user, enforced server-side); an identified-user match can only be
 * inspected — user→user merge does not exist. The component renders nothing
 * when there are no matches, so profiles without duplicates look unchanged.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { listDuplicateUsersFn, type DuplicatePrincipalMatch } from '@/lib/server/functions/admin'
import { useMergeLeadIntoUser } from '@/lib/client/mutations'
import type { PrincipalId } from '@quackback/ids'

interface DuplicateUsersWarningProps {
  /** The profile being viewed (the merge target for lead matches). */
  principalId: PrincipalId
  currentName: string | null
  /** people.manage gate — without it the warning is read-only. */
  canManage: boolean
}

const REASON_LABEL: Record<DuplicatePrincipalMatch['reasons'][number], string> = {
  email: 'Same email',
  name: 'Similar name',
}

export function DuplicateUsersWarning({
  principalId,
  currentName,
  canManage,
}: DuplicateUsersWarningProps) {
  const queryClient = useQueryClient()
  const [mergeTarget, setMergeTarget] = useState<DuplicatePrincipalMatch | null>(null)
  const mergeLead = useMergeLeadIntoUser()

  const duplicates = useQuery({
    queryKey: ['admin', 'user-duplicates', principalId],
    queryFn: () => listDuplicateUsersFn({ data: { principalId } }),
  })

  const matches = duplicates.data ?? []
  if (matches.length === 0) return null

  const confirmMerge = () => {
    if (!mergeTarget) return
    mergeLead.mutate(
      { principalId: mergeTarget.principalId, targetPrincipalId: principalId },
      {
        onSuccess: () => {
          toast.success(`Merged ${mergeTarget.name} into ${currentName || 'this user'}`)
          setMergeTarget(null)
          void queryClient.invalidateQueries({ queryKey: ['admin', 'user-duplicates'] })
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'Failed to merge')
        },
      }
    )
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2">
        <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-medium text-amber-700 dark:text-amber-300">
          Possible duplicate{matches.length > 1 ? 's' : ''}
        </h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {matches.length === 1
          ? 'Another profile may be the same person.'
          : `${matches.length} other profiles may be the same person.`}
      </p>
      <div className="mt-2.5 space-y-1.5">
        {matches.map((match) => (
          <div
            key={match.principalId}
            className="flex items-center gap-2.5 rounded-md border border-border/50 bg-background/60 px-2.5 py-2"
          >
            <Avatar src={match.avatarUrl} name={match.name} className="h-7 w-7" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{match.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {match.email ?? 'No email'}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {match.isLead && (
                <Badge size="sm" variant="secondary">
                  Lead
                </Badge>
              )}
              {match.reasons.map((reason) => (
                <Badge
                  key={reason}
                  size="sm"
                  variant="outline"
                  className="border-amber-500/40 text-amber-700 dark:text-amber-400"
                >
                  {REASON_LABEL[reason]}
                </Badge>
              ))}
            </span>
            {match.isLead && canManage ? (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setMergeTarget(match)}
              >
                Merge…
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="shrink-0" asChild>
                <Link to="/admin/users" search={{ selected: match.principalId }}>
                  View
                </Link>
              </Button>
            )}
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={mergeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMergeTarget(null)
        }}
        title={`Merge ${mergeTarget?.name ?? 'this lead'} into ${currentName || 'this user'}?`}
        description="The lead's conversations, posts, comments and votes move to this user, and the lead disappears from the directory. This cannot be undone."
        confirmLabel="Merge"
        isPending={mergeLead.isPending}
        onConfirm={confirmMerge}
      />
      {mergeLead.isPending && (
        <ArrowPathIcon className="mt-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}
