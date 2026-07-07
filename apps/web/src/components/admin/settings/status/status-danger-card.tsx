import { useState } from 'react'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
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
    <SettingsCard title="Danger zone" description="These actions can't be undone." variant="danger">
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="pr-4">
          <div className="text-sm font-medium">Clear incident history</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Deletes all resolved incidents, updates, and uptime history. Components stay.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/30"
          onClick={() => setConfirmOpen(true)}
        >
          Clear history
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Clear incident history?"
        description="This permanently deletes every resolved incident, its updates, and all uptime history. Your components and any open incident are kept. This cannot be undone."
        confirmLabel="Clear history"
        variant="destructive"
        isPending={clearHistory.isPending}
        onConfirm={handleConfirm}
      />
    </SettingsCard>
  )
}
