import { CopyButton } from '@/components/shared/copy-button'
import { WarningBox } from '@/components/shared/warning-box'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface SecretRevealDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  secretLabel: string
  secretValue: string | null
  confirmLabel?: string
  children?: React.ReactNode
}

export function SecretRevealDialog({
  open,
  onOpenChange,
  title,
  description,
  secretLabel,
  secretValue,
  confirmLabel = "I've saved this",
  children,
}: SecretRevealDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <WarningBox
            variant="warning"
            title={`Copy this ${secretLabel.toLowerCase()} now`}
            description="This is the only time you'll see it. Store it securely and never share it publicly."
          />

          <div className="space-y-2">
            <label className="text-sm font-medium">{secretLabel}</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-muted px-3 py-2.5 font-mono text-sm break-all">
                {secretValue}
              </code>
              <CopyButton
                value={secretValue ?? ''}
                aria-label={`Copy ${secretLabel.toLowerCase()} to clipboard`}
              />
            </div>
          </div>

          {children}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
