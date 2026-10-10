import { Suspense } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface UrlModalShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible title for screen readers */
  srTitle: string
  /** Content is only rendered when a validated ID exists */
  hasValidId: boolean
  children: React.ReactNode
}

export function UrlModalShell({
  open,
  onOpenChange,
  srTitle,
  hasValidId,
  children,
}: UrlModalShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0 gap-0 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{srTitle}</DialogTitle>
        {hasValidId && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[400px]">
                <Spinner />
              </div>
            }
          >
            {children}
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Lucide's loader-circle, drawn here rather than imported: the admin layout
 * renders this shell on every admin page, and the icon module would otherwise
 * be one more chunk each of them loads.
 */
function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-8 w-8 animate-spin text-muted-foreground"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
