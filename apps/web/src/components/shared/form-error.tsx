import { cn } from '@/lib/shared/utils'

interface FormErrorProps {
  message: string
  className?: string
}

export function FormError({ message, className }: FormErrorProps) {
  return (
    <div className={cn('rounded-md bg-destructive/10 p-3 text-sm text-destructive', className)}>
      {message}
    </div>
  )
}
