import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NoSymbolIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { PrincipalId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import {
  blockPersonFn,
  unblockPersonFn,
  getPersonBlockStatusFn,
} from '@/lib/server/functions/blocking'

/** Shared query key so the badge and the button dedupe to one fetch per person. */
function blockStatusKey(principalId: PrincipalId) {
  return ['admin', 'person-block-status', principalId] as const
}

/**
 * Block state for a person. React Query dedupes across every caller with the
 * same principal, so a surface can read this for a "Blocked" badge while the
 * {@link BlockPersonControl} button reads it too, with a single request.
 */
export function usePersonBlockStatus(principalId: PrincipalId | undefined) {
  const query = useQuery({
    queryKey: blockStatusKey(principalId as PrincipalId),
    queryFn: () => getPersonBlockStatusFn({ data: { principalId: principalId as PrincipalId } }),
    enabled: !!principalId,
    staleTime: 30_000,
  })
  return { blocked: query.data?.blockedAt != null, isLoading: query.isLoading }
}

/**
 * Block / Unblock action for a person (support platform §4.6). Blocking rejects
 * their future messages and re-registration; unblocking restores them. Confirmed
 * before blocking, immediate on unblock. Reused by the People profile and the
 * conversation detail panel.
 */
export function BlockPersonControl({
  principalId,
  personName,
  className,
  size = 'sm',
}: {
  principalId: PrincipalId
  personName?: string | null
  className?: string
  size?: 'sm' | 'default'
}) {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { blocked, isLoading } = usePersonBlockStatus(principalId)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: blockStatusKey(principalId) })

  const blockMut = useMutation({
    mutationFn: () => blockPersonFn({ data: { principalId } }),
    onSuccess: async () => {
      await invalidate()
      toast.success('Person blocked')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to block'),
  })
  const unblockMut = useMutation({
    mutationFn: () => unblockPersonFn({ data: { principalId } }),
    onSuccess: async () => {
      await invalidate()
      toast.success('Person unblocked')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to unblock'),
  })
  const busy = blockMut.isPending || unblockMut.isPending

  if (isLoading) return null

  return (
    <>
      <Button
        type="button"
        variant={blocked ? 'outline' : 'destructive'}
        size={size}
        className={className}
        disabled={busy}
        onClick={() => (blocked ? unblockMut.mutate() : setConfirmOpen(true))}
      >
        <NoSymbolIcon className="h-4 w-4" />
        {blocked ? 'Unblock' : 'Block'}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Block ${personName || 'this person'}?`}
        description="They will not be able to send new messages or sign in again. Their existing activity stays, and you can unblock them at any time."
        confirmLabel="Block"
        variant="destructive"
        isPending={blockMut.isPending}
        onConfirm={() => blockMut.mutate()}
      />
    </>
  )
}
