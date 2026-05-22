import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'

interface PortalPrivacyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

const PRIVATE_CONSEQUENCES = [
  {
    heading: 'Public visitors lose access',
    body: 'Anyone who could view the portal without an account will no longer be able to. Your team is not affected.',
  },
  {
    heading: 'Search engines stop indexing it',
    body: 'A private portal is removed from search results, and pages that are already indexed will drop over time.',
  },
  {
    heading: 'You must grant access',
    body: 'Configure who can get in — such as allowed email domains — or external users will not be able to reach the portal.',
  },
  {
    heading: 'Embedded widgets may be affected',
    body: 'Widgets and embeds may stop working for visitors who are not signed in.',
  },
]

export function PortalPrivacyDialog({ open, onOpenChange, onConfirm }: PortalPrivacyDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Make this portal private?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Switching to private has the following effects:</p>
              <ul className="space-y-2">
                {PRIVATE_CONSEQUENCES.map(({ heading, body }) => (
                  <li key={heading} className="text-sm">
                    <span className="font-medium text-foreground">{heading}.</span>{' '}
                    <span className="text-muted-foreground">{body}</span>
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: 'destructive' }))}
            onClick={onConfirm}
          >
            Make private
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
