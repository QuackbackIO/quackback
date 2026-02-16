import { ArrowTopRightOnSquareIcon } from '@heroicons/react/16/solid'
import { cn } from '@/lib/shared/utils'

interface DocsLinkProps {
  href: string
  className?: string
  children: React.ReactNode
}

export function DocsLink({ href, className, children }: DocsLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('inline-flex items-center gap-1 text-primary hover:underline', className)}
    >
      {children}
      <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
    </a>
  )
}
