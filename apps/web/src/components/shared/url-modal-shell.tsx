import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
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
        className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{srTitle}</DialogTitle>
        {hasValidId && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
