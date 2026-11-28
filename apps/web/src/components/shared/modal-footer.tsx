import { KeyboardHint } from '@/components/shared/keyboard-hint'
import { Button } from '@/components/ui/button'

interface ModalFooterProps {
  onCancel: () => void
  submitLabel: string
  isPending?: boolean
  /** Defaults to "to save" */
  hintAction?: string
  /** Extra buttons rendered before Cancel (e.g. mobile settings sheet trigger) */
  children?: React.ReactNode
  /** Set to "submit" for form submit buttons, "button" for onClick handlers */
  submitType?: 'submit' | 'button'
  onSubmit?: () => void
  /** Disable submit independently of isPending (e.g. no changes) */
  submitDisabled?: boolean
}

export function ModalFooter({
  onCancel,
  submitLabel,
  isPending,
  hintAction = 'to save',
  children,
  submitType = 'submit',
  onSubmit,
  submitDisabled,
}: ModalFooterProps) {
  // A long submit label ("Post update & reopen as Investigating") must never
  // be clipped on a narrow screen: the actions wrap onto another line, and a
  // label wider than the whole footer wraps inside its button.
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-t bg-muted/30 shrink-0">
      <KeyboardHint keys={['Mod', 'Enter']} action={hintAction} />
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 ms-auto">
        {children}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type={submitType}
          size="sm"
          className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-center"
          onClick={submitType === 'button' ? onSubmit : undefined}
          disabled={isPending || submitDisabled}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
