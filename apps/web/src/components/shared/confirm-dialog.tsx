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
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
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
          <AlertDialogCancel disabled={isPending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className={cn(variant === 'destructive' && buttonVariants({ variant: 'destructive' }))}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
