import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { wipeCloudWorkspaceFn } from '@/lib/server/functions/workspace-wipe'

/** The irreversible workspace-wide action; absent when the deployment offers none. */
export function WorkspaceDangerCard({ cloudEnabled }: { cloudEnabled: boolean }) {
  const [wipeOpen, setWipeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!cloudEnabled) return null

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

  return (
    <SettingsCard variant="danger" title="Danger zone">
      <SettingRows>
        <SettingRow
          label="Delete workspace"
          description="Takes this workspace offline. It can be restored until it is purged."
          control={
            <Button
              size="sm"
              variant="outline-destructive"
              disabled={busy}
              onClick={() => setWipeOpen(true)}
            >
              Delete workspace
            </Button>
          }
        />
      </SettingRows>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      <ConfirmDialog
        open={wipeOpen}
        onOpenChange={setWipeOpen}
        title="Delete workspace?"
        description="The workspace is taken offline and can be restored until it is purged. Export first if you still need a copy."
        variant="destructive"
        confirmLabel={busy ? 'Deleting…' : 'Delete workspace'}
        isPending={busy}
        onConfirm={wipe}
      />
    </SettingsCard>
  )
}
