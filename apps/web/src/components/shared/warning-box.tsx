import type { ComponentType } from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'

const variants = {
  destructive: {
    container: 'bg-destructive/10 border-destructive/20',
    icon: 'text-destructive',
    title: 'text-destructive',
  },
  warning: {
    container: 'bg-amber-500/10 border-amber-500/20',
    icon: 'text-amber-600',
    title: 'text-amber-800 dark:text-amber-200',
  },
} as const

interface WarningBoxProps {
  variant?: 'destructive' | 'warning'
  title: string
  description?: React.ReactNode
  icon?: ComponentType<{ className?: string }>
  className?: string
}

export function WarningBox({
  variant = 'destructive',
  title,
  description,
  icon: Icon = ExclamationTriangleIcon,
  className,
}: WarningBoxProps) {
  const styles = variants[variant]

  return (
    <div
      className={cn('flex items-start gap-3 rounded-lg border p-4', styles.container, className)}
    >
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', styles.icon)} />
      <div className="text-sm">
        <p className={cn('font-medium', styles.title)}>{title}</p>
        {description && <p className="text-muted-foreground mt-1">{description}</p>}
      </div>
    </div>
  )
}
