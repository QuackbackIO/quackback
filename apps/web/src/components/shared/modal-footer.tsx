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
  return (
    <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t bg-muted/30 shrink-0">
      <KeyboardHint keys={['Cmd', 'Enter']} action={hintAction} />
      <div className="flex items-center gap-2 sm:ml-0 ml-auto">
        {children}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type={submitType}
          size="sm"
          onClick={submitType === 'button' ? onSubmit : undefined}
          disabled={isPending || submitDisabled}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
