import { useState } from 'react'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useClearStatusHistory } from '@/lib/client/mutations/status'

/**
 * "Clear incident history" (Status Product Spec §8): hard-deletes resolved
 * incidents/maintenance and the uptime history, keeping components and any
 * still-open incident. Guarded by a confirm dialog.
 */
export function StatusDangerCard() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const clearHistory = useClearStatusHistory()

  const handleConfirm = async () => {
    try {
      const result = await clearHistory.mutateAsync()
      toast.success(
        `Cleared ${result.incidents} resolved ${result.incidents === 1 ? 'incident' : 'incidents'} and uptime history.`
      )
      setConfirmOpen(false)
    } catch {
      toast.error('Could not clear history. Please try again.')
    }
  }

  return (
    <SettingsCard title="Danger zone" variant="danger">
      <SettingRows>
        <SettingRow
          label="Clear incident history"
          description="Deletes resolved incidents, their updates and uptime history"
          control={
            <Button variant="outline-destructive" size="sm" onClick={() => setConfirmOpen(true)}>
              Clear history
            </Button>
          }
        />
      </SettingRows>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete incident history?"
        description="This permanently deletes every resolved incident, its updates, and all uptime history. Your components and any open incident are kept. This cannot be undone."
        confirmLabel="Delete incident history"
        variant="destructive"
        isPending={clearHistory.isPending}
        onConfirm={handleConfirm}
      />
    </SettingsCard>
  )
}
