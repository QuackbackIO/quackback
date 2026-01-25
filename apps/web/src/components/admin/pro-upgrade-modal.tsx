import { SparklesIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useWorkspaceId } from '@/lib/hooks/use-workspace-id'

interface ProUpgradeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  feature: string
  description: string
  benefits?: string[]
}

/**
 * A modal component to show when a Pro feature is not available.
 * Displays an upgrade prompt with feature benefits and action buttons.
 */
export function ProUpgradeModal({
  open,
  onOpenChange,
  feature,
  description,
  benefits = [],
}: ProUpgradeModalProps) {
  const workspaceId = useWorkspaceId()

  // Build external billing URL
  const billingUrl = workspaceId
    ? `https://quackback.io/billing?workspace=${workspaceId}`
    : 'https://quackback.io/billing'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-center">
          {/* Icon */}
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
            <SparklesIcon className="h-6 w-6 text-primary" />
          </div>

          <DialogTitle className="text-xl">{feature}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Benefits list */}
        {benefits.length > 0 && (
          <ul className="text-sm space-y-2 bg-muted/50 rounded-lg p-4">
            {benefits.map((benefit, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span className="text-muted-foreground">{benefit}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Pro badge */}
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <SparklesIcon className="h-4 w-4" />
            Pro Feature
          </div>
        </div>

        <DialogFooter className="sm:justify-center">
          <Button asChild>
            <a href={billingUrl} target="_blank" rel="noopener noreferrer">
              Upgrade to Pro
              <ArrowTopRightOnSquareIcon className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
