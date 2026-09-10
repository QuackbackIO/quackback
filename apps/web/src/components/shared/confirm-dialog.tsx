import { useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import { WarningBox } from './warning-box'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  warning?: { title: string; description?: React.ReactNode }
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  isPending?: boolean
  onConfirm: () => void | Promise<void>
  children?: React.ReactNode
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isPending,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const startedRef = useRef(false)
  const [started, setStarted] = useState(false)
  const busy = Boolean(isPending) || started

  function resetStarted() {
    startedRef.current = false
    setStarted(false)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetStarted()
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription asChild={typeof description !== 'string'}>
              {typeof description === 'string' ? description : <div>{description}</div>}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {(warning || children) && (
          <div className="space-y-4">
            {warning && (
              <WarningBox
                variant={variant === 'destructive' ? 'destructive' : 'warning'}
                title={warning.title}
                description={warning.description}
              />
            )}
            {children}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              if (busy || startedRef.current) {
                event.preventDefault()
                return
              }
              let result: void | Promise<void>
              try {
                result = onConfirm()
              } catch {
                return
              }
              if (result && typeof result.then === 'function') {
                event.preventDefault()
                startedRef.current = true
                setStarted(true)
                void result.catch(() => undefined).finally(resetStarted)
              }
            }}
            disabled={busy}
            className={cn(variant === 'destructive' && buttonVariants({ variant: 'destructive' }))}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
