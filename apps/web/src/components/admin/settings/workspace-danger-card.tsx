import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ExportWorkspaceAction } from '@/components/admin/settings/imports/export-workspace-action'
import { wipeCloudWorkspaceFn } from '@/lib/server/functions/workspace-wipe'

export function WorkspaceDangerCard({ cloudEnabled }: { cloudEnabled: boolean }) {
  const [wipeOpen, setWipeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function wipe() {
    setBusy(true)
    setError(null)
    try {
      const result = await wipeCloudWorkspaceFn({ data: { confirm: 'wipe' } })
      window.location.assign(result.dashboardUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not wipe this workspace')
      setBusy(false)
      setWipeOpen(false)
    }
  }

  return (
    <SettingsCard
      variant="danger"
      title="Danger zone"
      description="Export a copy of this workspace, or permanently remove it from the live fleet"
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Export data</p>
          <p className="text-xs text-muted-foreground">
            Downloads stay in this workspace. They never include platform keys.
          </p>
          <ExportWorkspaceAction />
          <p className="text-xs text-muted-foreground">
            Full history lives under{' '}
            <Link to="/admin/settings/imports" className="underline underline-offset-2">
              Imports &amp; exports
            </Link>
            .
          </p>
        </div>
        {cloudEnabled ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Wipe this workspace</p>
            <p className="text-xs text-muted-foreground">
              Soft-deletes the workspace. Restore is possible from the control plane until purge.
            </p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => setWipeOpen(true)}
            >
              Wipe workspace
            </Button>
            <ConfirmDialog
              open={wipeOpen}
              onOpenChange={setWipeOpen}
              title="Wipe this workspace?"
              description="The workspace leaves the live fleet. Export first if you still need a copy."
              variant="destructive"
              confirmLabel={busy ? 'Wiping…' : 'Wipe workspace'}
              isPending={busy}
              onConfirm={wipe}
            />
          </div>
        ) : null}
      </div>
    </SettingsCard>
  )
}
