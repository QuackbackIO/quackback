import { lazy, Suspense, useEffect, useMemo, useState, type ComponentProps } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { BellIcon } from '@heroicons/react/24/outline'
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import {
  publicStatusPageQueries,
  publicStatusSubscriptionQueries,
  statusKeys,
} from '@/lib/client/queries/status'
import { subscribeStatusFn, unsubscribeStatusFn } from '@/lib/server/functions/status-subscriptions'
import type { StatusComponentId } from '@quackback/ids'
import {
  savePendingStatusSubscription,
  takePendingStatusSubscription,
  type PendingStatusSubscription,
} from './pending-status-subscription'

/** What `subscribeStatusFn` throws for a caller without a real account: no
 *  session at all (`requireAuth`), or a lazy/anonymous better-auth session
 *  (see `lib/server/functions/status-subscriptions.ts`). Either way the fix is
 *  to sign in, not to retry. */
const SIGN_IN_ERROR_MESSAGES = new Set([
  'Authentication required',
  'Anonymous interaction is not enabled',
])

// Only a subscriber who clicks "Subscribed" needs the confirm dialog.
const LazyConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({ default: m.ConfirmDialog }))
)

function ConfirmDialog(props: ComponentProps<typeof LazyConfirmDialog>) {
  return (
    <Suspense fallback={null}>
      <LazyConfirmDialog {...props} />
    </Suspense>
  )
}

interface StatusSubscribeButtonProps {
  className?: string
}

/**
 * Self-serve Subscribe/Subscribed toggle for the public status page. Unlike
 * `ChangelogSubscribeButton` (only rendered once the caller is already
 * identified), this one is always visible: an anonymous visitor can open the
 * dialog and pick a scope, and submitting opens the portal sign-in dialog,
 * since `subscribeStatusFn` requires a real signed-in principal. The chosen
 * scope is held across sign-in (see `pending-status-subscription.ts`) and
 * the subscription completes once the visitor is back, signed in.
 * Unsubscribing asks first.
 */
export function StatusSubscribeButton({ className }: StatusSubscribeButtonProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const authPopover = useAuthPopoverSafe()
  const session = useSessionContext()
  const signedIn = !!session?.user && session.user.principalType !== 'anonymous'
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'page' | 'components'>('page')
  const [selectedIds, setSelectedIds] = useState<StatusComponentId[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmMounted, setConfirmMounted] = useState(false)

  // Only a signed-in visitor has a subscription to look up; for anyone else
  // the read could only fail (and retry).
  const { data: mySubscription } = useQuery({
    ...publicStatusSubscriptionQueries.mine(),
    enabled: signedIn,
  })
  // Lazily loaded only once the dialog is open (and cheap — the same query the
  // index page itself uses, so it's usually already warm in the cache).
  const { data: pageData } = useQuery({ ...publicStatusPageQueries.get(), enabled: open })

  const components = useMemo(() => {
    if (!pageData) return []
    return [
      ...pageData.snapshot.ungroupedComponents,
      ...pageData.snapshot.groups.flatMap((g) => g.components),
    ]
  }, [pageData])

  const invalidateSubscription = () =>
    queryClient.invalidateQueries({ queryKey: statusKeys.mySubscription() })

  /** Send the visitor through sign-in, keeping what they chose for after. */
  function requestSignIn(pending: PendingStatusSubscription) {
    savePendingStatusSubscription(pending)
    setOpen(false)
    // An SSO redirect returns here (not to the portal home) once it's done.
    authPopover?.openAuthPopover({ mode: 'login', callbackUrl: window.location.pathname })
  }

  const subscribeMutation = useMutation({
    mutationFn: (input: PendingStatusSubscription) => subscribeStatusFn({ data: input }),
    onSuccess: () => {
      invalidateSubscription()
      setOpen(false)
      toast.success(
        intl.formatMessage({
          id: 'portal.status.subscribe.success',
          defaultMessage: 'Subscribed to status updates',
        })
      )
    },
    onError: (error: unknown, input) => {
      // A session that lapsed since the page loaded.
      if (error instanceof Error && SIGN_IN_ERROR_MESSAGES.has(error.message)) {
        requestSignIn(input)
        return
      }
      toast.error(
        intl.formatMessage({
          id: 'portal.status.subscribe.error',
          defaultMessage: 'Could not subscribe. Please try again.',
        })
      )
    },
  })

  // Back from signing in (here, or in the tab a magic link opened): finish
  // the subscription the visitor asked for before they left.
  const { mutate: subscribe } = subscribeMutation
  useEffect(() => {
    if (!signedIn) return
    const pending = takePendingStatusSubscription()
    if (pending) subscribe(pending)
  }, [signedIn, subscribe])

  const unsubscribeMutation = useMutation({
    mutationFn: () => unsubscribeStatusFn(),
    onSuccess: () => {
      invalidateSubscription()
      setConfirmOpen(false)
      toast.success(
        intl.formatMessage({
          id: 'portal.status.unsubscribe.success',
          defaultMessage: 'Unsubscribed from status updates',
        })
      )
    },
    onError: () => {
      toast.error(
        intl.formatMessage({
          id: 'portal.status.unsubscribe.error',
          defaultMessage: 'Could not unsubscribe. Please try again.',
        })
      )
    },
  })

  // A cached answer must not outlive the session it was read for.
  const subscribed = signedIn && (mySubscription?.subscribed ?? false)

  if (subscribed) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className={cn('shrink-0 gap-1.5', className)}
          disabled={unsubscribeMutation.isPending}
          onClick={() => {
            setConfirmMounted(true)
            setConfirmOpen(true)
          }}
        >
          <BellIconSolid className="h-4 w-4 text-primary" />
          <span className="sr-only sm:not-sr-only">
            {intl.formatMessage({ id: 'portal.status.subscribed', defaultMessage: 'Subscribed' })}
          </span>
        </Button>
        {confirmMounted && (
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={intl.formatMessage({
              id: 'portal.status.unsubscribe.confirmTitle',
              defaultMessage: 'Unsubscribe from status updates?',
            })}
            description={intl.formatMessage({
              id: 'portal.status.unsubscribe.confirmDescription',
              defaultMessage: "You'll stop getting emails about incidents and maintenance.",
            })}
            confirmLabel={intl.formatMessage({
              id: 'portal.status.unsubscribe.confirm',
              defaultMessage: 'Unsubscribe',
            })}
            cancelLabel={intl.formatMessage({
              id: 'portal.status.unsubscribe.cancel',
              defaultMessage: 'Stay subscribed',
            })}
            isPending={unsubscribeMutation.isPending}
            // Resolves on success (which closes the dialog); a failure keeps
            // it open beside the error toast so the visitor can try again.
            onConfirm={async () => {
              await unsubscribeMutation.mutateAsync()
            }}
          />
        )}
      </>
    )
  }

  function handleSubscribe() {
    const pending: PendingStatusSubscription = {
      scope,
      componentIds: scope === 'components' ? selectedIds : [],
    }
    if (!signedIn) {
      requestSignIn(pending)
      return
    }
    subscribeMutation.mutate(pending)
  }

  function toggleComponent(id: StatusComponentId, checked: boolean) {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((existing) => existing !== id)))
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn('shrink-0 gap-1.5', className)}
        onClick={() => setOpen(true)}
      >
        <BellIcon className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">
          {intl.formatMessage({ id: 'portal.status.subscribe.cta', defaultMessage: 'Subscribe' })}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({
                id: 'portal.status.subscribeDialog.title',
                defaultMessage: 'Subscribe to updates',
              })}
            </DialogTitle>
            <DialogDescription>
              {intl.formatMessage({
                id: 'portal.status.subscribeDialog.description',
                defaultMessage: "We'll email you when incidents and maintenance are posted.",
              })}
            </DialogDescription>
            {/* Said before the visitor picks a scope, not after Subscribe. */}
            {!signedIn && (
              <p className="text-xs text-muted-foreground">
                <FormattedMessage
                  id="portal.status.subscribeDialog.accountNote"
                  defaultMessage="Email updates need a free portal account. Or follow the <rss>RSS feed</rss>."
                  values={{
                    rss: (chunks) => (
                      <a
                        href="/status/feed"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {chunks}
                      </a>
                    ),
                  }}
                />
              </p>
            )}
          </DialogHeader>

          <RadioGroup
            value={scope}
            onValueChange={(value) => setScope(value as 'page' | 'components')}
          >
            <label
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
                scope === 'page' ? 'border-primary/60 bg-primary/5' : 'border-border/60'
              )}
            >
              <RadioGroupItem value="page" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  {intl.formatMessage({
                    id: 'portal.status.subscribeDialog.page.title',
                    defaultMessage: 'All updates',
                  })}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {intl.formatMessage({
                    id: 'portal.status.subscribeDialog.page.description',
                    defaultMessage:
                      'Every incident and scheduled maintenance across the whole page.',
                  })}
                </span>
              </span>
            </label>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
                scope === 'components' ? 'border-primary/60 bg-primary/5' : 'border-border/60'
              )}
            >
              <RadioGroupItem value="components" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  {intl.formatMessage({
                    id: 'portal.status.subscribeDialog.components.title',
                    defaultMessage: 'Specific services',
                  })}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {intl.formatMessage({
                    id: 'portal.status.subscribeDialog.components.description',
                    defaultMessage: 'Only the services you pick below.',
                  })}
                </span>
              </span>
            </label>
          </RadioGroup>

          {scope === 'components' && (
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border/50 p-3">
              {components.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {intl.formatMessage({
                    id: 'portal.status.subscribeDialog.components.loading',
                    defaultMessage: 'Loading services…',
                  })}
                </p>
              ) : (
                components.map((component) => (
                  <label key={component.id} className="flex items-center gap-2.5 text-sm">
                    <Checkbox
                      checked={selectedIds.includes(component.id)}
                      onCheckedChange={(checked) => toggleComponent(component.id, checked === true)}
                      data-in-label
                    />
                    {component.name}
                  </label>
                ))
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={handleSubscribe}
              disabled={
                subscribeMutation.isPending || (scope === 'components' && selectedIds.length === 0)
              }
            >
              {subscribeMutation.isPending
                ? intl.formatMessage({
                    id: 'portal.status.subscribeDialog.submitting',
                    defaultMessage: 'Subscribing…',
                  })
                : intl.formatMessage({
                    id: 'portal.status.subscribeDialog.submit',
                    defaultMessage: 'Subscribe',
                  })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
