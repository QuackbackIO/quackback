import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { wipeCloudWorkspaceFn } from '@/lib/server/functions/workspace-wipe'

/** How long Quackback Cloud keeps a deleted workspace restorable. Set by the control plane. */
const RESTORE_WINDOW_DAYS = 30

/** The irreversible workspace-wide action; absent when the deployment offers none. */
export function WorkspaceDangerCard({
  cloudEnabled,
  workspaceName,
}: {
  cloudEnabled: boolean
  /** Typed back to confirm. Without one, the word "delete" is typed instead. */
  workspaceName?: string
}) {
  const [wipeOpen, setWipeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  if (!cloudEnabled) return null

  const expected = workspaceName?.trim() || 'delete'
  const confirmed = typed.trim() === expected

  async function wipe() {
    setBusy(true)
    setError(null)
    try {
      const result = await wipeCloudWorkspaceFn({ data: { confirm: 'wipe' } })
      window.location.assign(result.dashboardUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this workspace')
      setBusy(false)
      setWipeOpen(false)
    }
  }

  function setOpen(open: boolean) {
    setWipeOpen(open)
    if (!open) setTyped('')
  }

  return (
    <SettingsCard variant="danger" title="Danger zone">
      <SettingRows>
        <SettingRow
          label="Delete workspace"
          description={`Takes this workspace offline. You can restore it from your Quackback dashboard for ${RESTORE_WINDOW_DAYS} days, then it's permanently deleted.`}
          control={
            <Button
              size="sm"
              variant="outline-destructive"
              disabled={busy}
              onClick={() => setOpen(true)}
            >
              Delete workspace
            </Button>
          }
        />
      </SettingRows>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      <ConfirmDialog
        open={wipeOpen}
        onOpenChange={setOpen}
        title="Delete workspace?"
        description={`It goes offline straight away for everyone, including your portal, widget and custom domain. You can restore it from your Quackback dashboard for ${RESTORE_WINDOW_DAYS} days. After that it's permanently deleted. Your subscription won't renew.`}
        variant="destructive"
        confirmLabel={busy ? 'Deleting…' : 'Delete workspace'}
        isPending={busy}
        confirmDisabled={!confirmed}
        onConfirm={wipe}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Need a copy first?{' '}
            <Link
              to="/admin/settings/imports"
              className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2"
            >
              Export your data
            </Link>{' '}
            before you delete.
          </p>
          <label className="block space-y-1.5 text-sm">
            <span>
              Type <span className="font-semibold">{expected}</span> to confirm
            </span>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              aria-label={`Type ${expected} to confirm`}
            />
          </label>
        </div>
      </ConfirmDialog>
    </SettingsCard>
  )
}
