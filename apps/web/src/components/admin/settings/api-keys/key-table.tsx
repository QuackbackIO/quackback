import { cn } from '@/lib/shared/utils'

/*
 * The key lists' table: the look of the shared table component, written out
 * here so the Developers page does not load that component as a chunk of its
 * own for two small lists.
 */

export function KeyTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className="w-full text-sm [&_tbody_tr:last-child]:border-0 [&_tr]:border-b [&_tr]:border-border/50">
        {children}
      </table>
    </div>
  )
}

export function KeyTableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-4 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

export function KeyTableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />
}
