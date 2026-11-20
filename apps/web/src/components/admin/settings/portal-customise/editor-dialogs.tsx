import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Link } from '@tanstack/react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import { UpgradeModal } from '@/components/admin/upgrade'
import { conflictPartNames, type PortalEditor } from './use-portal-editor'

/**
 * The editor's three questions: leaving with unpublished changes, someone
 * else's change to the same settings, and a plan that lacks the Advanced CSS
 * rules (any other plan refusal opens the usual upgrade dialog).
 */
export function PortalEditorDialogs({ editor }: { editor: PortalEditor }) {
  const { blocker, conflict, planRefusal } = editor
  const count = editor.changes.length
  return (
    <>
      <AlertDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without publishing?</AlertDialogTitle>
            <AlertDialogDescription>
              {count === 1 ? '1 change will be lost.' : `${count} changes will be lost.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => blocker.status === 'blocked' && blocker.proceed()}
            >
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) editor.dismissConflict()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Someone else changed these settings</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>They published a change while you were editing:</p>
                <ul className="list-disc ps-5 text-foreground">
                  {conflictPartNames(conflict?.parts ?? []).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={editor.loadTheirs}>Load theirs</AlertDialogCancel>
            <AlertDialogAction onClick={() => void editor.keepMine()}>Keep mine</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={planRefusal?.customCss === true}
        onOpenChange={(open) => {
          if (!open) editor.dismissPlanRefusal()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Your own CSS rules need the Business plan</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Custom CSS is a Business feature. Upgrade to Business to enable it.</p>
                <p>
                  Everything else can go live now. Your rules stay in Advanced CSS, marked not live.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" asChild>
              <Link
                to="/admin/settings/billing"
                search={{ checkout: undefined, billing_error: undefined }}
              >
                See Business plan
              </Link>
            </Button>
            <AlertDialogAction onClick={() => void editor.publishRest()}>
              Publish the rest
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {planRefusal && !planRefusal.customCss ? (
        <UpgradeModal
          open
          onOpenChange={(open) => {
            if (!open) editor.dismissPlanRefusal()
          }}
          description={planRefusal.description}
        />
      ) : null}
    </>
  )
}
