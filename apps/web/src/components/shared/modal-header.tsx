import { ArrowTopRightOnSquareIcon, LinkIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface ModalHeaderProps {
  /** Breadcrumb section label (e.g. "Feedback", "Changelog", "Roadmap") */
  section: string
  /** Item title shown in breadcrumb */
  title: string
  onClose: () => void
  /** URL for the "View" button. Pass null/undefined to hide. */
  viewUrl?: string | null
  /** Extra action buttons rendered before View/Copy Link */
  children?: React.ReactNode
}

async function handleCopyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.success('Link copied to clipboard')
  } catch {
    toast.error('Failed to copy link')
  }
}

export function ModalHeader({ section, title, onClose, viewUrl, children }: ModalHeaderProps) {
  return (
    <header className="sticky top-0 z-20 bg-gradient-to-b from-card/98 to-card/95 backdrop-blur-md border-b border-border/40 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between px-6 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
          >
            <XMarkIcon className="h-4 w-4" />
          </Button>

          <div className="hidden sm:flex items-center gap-2 text-sm">
            <span className="text-muted-foreground/60">{section}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-foreground/80 font-medium truncate max-w-[240px]">{title}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {children}

          {viewUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => window.open(viewUrl, '_blank')}
              className="gap-1.5 h-8"
            >
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">View</span>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopyLink}
            className="gap-1.5 h-8"
          >
            <LinkIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Copy Link</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
