import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { signOut } from '@/lib/client/auth-client'
import {
  getCloudOwnerEmailFn,
  leaveCloudWorkspaceFn,
  transferWorkspaceOwnershipFn,
} from '@/lib/server/functions/ownership'
import { cloudMembershipActions } from './workspace-ownership'

export function CloudOwnershipActions({
  memberEmails,
  sessionEmail,
}: {
  memberEmails: string[]
  sessionEmail: string | null
}) {
  const { billingEnabled } = useRouteContext({ from: '__root__' })
  const ownerQuery = useQuery({
    queryKey: ['admin', 'cloud-owner'],
    queryFn: () => getCloudOwnerEmailFn(),
    enabled: Boolean(billingEnabled),
  })
  const [toEmail, setToEmail] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const actions = cloudMembershipActions({
    billingEnabled: Boolean(billingEnabled),
    ownerEmail: ownerQuery.data ?? null,
    currentEmail: sessionEmail,
  })
  const owner = ownerQuery.data?.trim().toLowerCase() ?? null
  const teammates = useMemo(
    () =>
      memberEmails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email && email !== owner),
    [memberEmails, owner]
  )

  if (!actions.showTransfer && !actions.showLeave) return null

  async function transfer() {
    if (!toEmail) return
    setBusy(true)
    setError(null)
    try {
      await transferWorkspaceOwnershipFn({ data: { toEmail } })
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transfer')
      setBusy(false)
      setTransferOpen(false)
    }
  }

  async function leave() {
    setBusy(true)
    setError(null)
    try {
      await leaveCloudWorkspaceFn({ data: {} })
      await signOut()
      window.location.assign('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave')
      setBusy(false)
      setLeaveOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {actions.showTransfer && teammates.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="transfer-owner" className="text-[13px]">
            Transfer to
          </label>
          <select
            id="transfer-owner"
            className="h-8 rounded-md border bg-background px-2 text-[13px]"
            value={toEmail}
            onChange={(event) => setToEmail(event.target.value)}
          >
            <option value="">Choose a teammate</option>
            {teammates.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={busy || !toEmail} onClick={() => setTransferOpen(true)}>
            Transfer ownership
          </Button>
        </div>
      ) : null}
      {actions.showLeave ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setLeaveOpen(true)}>
          Leave workspace
        </Button>
      ) : null}
      <ConfirmDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title="Transfer ownership?"
        description={`${toEmail} will become the owner of this workspace.`}
        confirmLabel={busy ? 'Transferring...' : 'Transfer ownership'}
        isPending={busy}
        onConfirm={transfer}
      />
      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave this workspace?"
        description="You will lose access to this workspace. The owner stays."
        variant="destructive"
        confirmLabel={busy ? 'Leaving...' : 'Leave workspace'}
        isPending={busy}
        onConfirm={leave}
      />
    </div>
  )
}
