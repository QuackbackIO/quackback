import { Link, type LinkProps } from '@tanstack/react-router'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'

interface BackLinkProps extends Omit<LinkProps, 'children'> {
  children: React.ReactNode
  className?: string
}

/**
 * Consistent back navigation button used for breadcrumb-style navigation.
 * Renders as a subtle ghost button with an arrow icon.
 */
export function BackLink({ children, className, ...props }: BackLinkProps) {
  return (
    <Link
      {...props}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors',
        className
      )}
    >
      <ArrowLeftIcon className="h-4 w-4" />
      <span>{children}</span>
    </Link>
  )
}
