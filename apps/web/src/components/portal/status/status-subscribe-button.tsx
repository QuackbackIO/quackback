import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
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
import {
  publicStatusPageQueries,
  publicStatusSubscriptionQueries,
  statusKeys,
} from '@/lib/client/queries/status'
import { subscribeStatusFn, unsubscribeStatusFn } from '@/lib/server/functions/status-subscriptions'
import type { StatusComponentId } from '@quackback/ids'

/** Matches the exact string `subscribeStatusFn` throws for a lazy/anonymous
 *  better-auth session — see `lib/server/functions/status-subscriptions.ts`. */
const ANONYMOUS_ERROR_MESSAGE = 'Anonymous interaction is not enabled'

interface StatusSubscribeButtonProps {
  className?: string
}

/**
 * Self-serve Subscribe/Subscribed toggle for the public status page. Unlike
 * `ChangelogSubscribeButton` (only rendered once the caller is already
 * identified), this one is always visible: an anonymous visitor can open the
 * dialog and pick a scope, and submitting surfaces the portal auth dialog
 * instead of a generic error, since `subscribeStatusFn` requires a real
 * signed-in principal.
 */
export function StatusSubscribeButton({ className }: StatusSubscribeButtonProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const authPopover = useAuthPopoverSafe()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'page' | 'components'>('page')
  const [selectedIds, setSelectedIds] = useState<StatusComponentId[]>([])

  const { data: mySubscription } = useQuery(publicStatusSubscriptionQueries.mine())
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

  const subscribeMutation = useMutation({
    mutationFn: (input: { scope: 'page' | 'components'; componentIds?: string[] }) =>
      subscribeStatusFn({ data: input }),
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
    onError: (error: unknown) => {
      if (error instanceof Error && error.message === ANONYMOUS_ERROR_MESSAGE) {
        setOpen(false)
        authPopover?.openAuthPopover({ mode: 'login' })
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

  const unsubscribeMutation = useMutation({
    mutationFn: () => unsubscribeStatusFn(),
    onSuccess: () => {
      invalidateSubscription()
      toast.success(
        intl.formatMessage({
          id: 'portal.status.unsubscribe.success',
          defaultMessage: 'Unsubscribed from status updates',
        })
      )
    },
  })

  const subscribed = mySubscription?.subscribed ?? false

  if (subscribed) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn('shrink-0 gap-1.5', className)}
        disabled={unsubscribeMutation.isPending}
        onClick={() => unsubscribeMutation.mutate()}
      >
        <BellIconSolid className="h-4 w-4 text-primary" />
        <span className="hidden sm:inline">
          {intl.formatMessage({ id: 'portal.status.subscribed', defaultMessage: 'Subscribed' })}
        </span>
      </Button>
    )
  }

  function handleSubscribe() {
    subscribeMutation.mutate({
      scope,
      componentIds: scope === 'components' ? selectedIds : undefined,
    })
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
        <span className="hidden sm:inline">
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
