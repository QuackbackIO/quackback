/**
 * Blocking prompt shown when a teammate close is refused because required
 * attributes are unfilled (single close and bulk close both funnel here).
 * The server is the enforcement point; this dialog explains the refusal and
 * points at the detail panel's Attributes section.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function RequiredAttributesDialog({
  messages,
  onClose,
}: {
  /** The blocked-close reasons (one per distinct message); null hides the dialog. */
  messages: string[] | null
  onClose: () => void
}) {
  return (
    <AlertDialog open={!!messages && messages.length > 0} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Required attributes missing</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {(messages ?? []).map((m) => (
                <p key={m}>{m}</p>
              ))}
              <p>Fill them in the Attributes section of the conversation panel, then close.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
