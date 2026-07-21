/**
 * The internal-sources leak gate (COPILOT-SIDEBAR-UX.md B.4), used by the
 * Copilot panel: any internal-sourced answer must clear this hard confirm
 * before it can reach a customer-facing composer. One component owns the
 * safety copy so the wording can never drift between hosts; only the subject
 * noun and the confirm label vary per host.
 */
import { Button, buttonVariants } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function InternalSourcesConfirm({
  open,
  noun,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  /** What is being gated — "answer" (panel) or "suggestion" (card). */
  noun: 'answer' | 'suggestion'
  /** The destructive proceed action's label, e.g. "Add to composer anyway". */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This {noun} uses internal sources</AlertDialogTitle>
          <AlertDialogDescription>
            It cites content your customers are not meant to see. Review before sending.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            className={buttonVariants({ variant: 'destructive' })}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
