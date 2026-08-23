import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import { CreditCardIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BillingSettings } from '@/components/admin/settings/billing/billing-settings'
import { billingQueries } from '@/lib/client/queries/billing'
import { checkoutSuccessCopy } from '@/lib/shared/billing/checkout-flash'
import { cn } from '@/lib/shared/utils'

const BILLING_ERROR_COPY: Record<string, string> = {
  seats_below_usage: 'Pick at least as many seats as people you already have.',
  already_on_plan: 'You are already on this plan.',
  unavailable: 'That billing action is not available right now.',
  invalid: 'That billing request was not valid. Try again from this page.',
  unauthorized: 'Sign in again to manage billing.',
  forbidden: 'You do not have permission to change billing.',
  not_teammate: 'You do not have permission to change billing.',
}

/**
 * Plan & billing.
 *
 * Gated on `billing.manage`, the permission the RBAC catalogue has carried
 * for this purpose since custom roles shipped. Owner holds it, Admin does
 * not. A valid control-plane projection is also required; self-hosted
 * workspaces therefore have no navigation item or commercial dependency.
 */
export const Route = createFileRoute('/admin/settings/billing')({
  validateSearch: (search: Record<string, unknown>) => ({
    checkout:
      search.checkout === 'success' || search.checkout === 'cancelled'
        ? search.checkout
        : undefined,
    billing_error: typeof search.billing_error === 'string' ? search.billing_error : undefined,
  }),
  loaderDeps: ({ search }) => ({ checkout: search.checkout }),
  loader: async ({ context, deps }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.BILLING_MANAGE)
    if (deps.checkout === 'success') {
      await context.queryClient.invalidateQueries({ queryKey: billingQueries.all })
    }
    await Promise.all([
      context.queryClient.ensureQueryData(billingQueries.overview()),
      context.queryClient.ensureQueryData(billingQueries.catalogue()).catch(() => null),
      context.queryClient.ensureQueryData(billingQueries.invoices()).catch(() => null),
    ])
    return {}
  },
  component: BillingPage,
})

function BillingPage() {
  const { billingEnabled } = useRouteContext({ from: '__root__' })
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  useEffect(() => {
    if (search.checkout === 'cancelled') {
      void navigate({ search: {}, replace: true })
    }
  }, [search.checkout, navigate])

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={CreditCardIcon}
        title="Plans & billing"
        description="Manage your plan, seats, and billing history here."
      />
      {search.checkout === 'success' ? (
        <CheckoutSuccessFlash onDismiss={() => navigate({ search: {}, replace: true })} />
      ) : null}
      {search.billing_error ? (
        <BillingFlash
          tone="error"
          title="Couldn’t update billing"
          body={
            BILLING_ERROR_COPY[search.billing_error] ??
            'Billing is temporarily unavailable. Try again in a moment.'
          }
          onDismiss={() => navigate({ search: {}, replace: true })}
        />
      ) : null}
      {billingEnabled ? (
        <BillingSettings />
      ) : (
        <p className="text-sm text-muted-foreground">
          Plan and billing is available only in a Quackback Cloud workspace.
        </p>
      )}
    </div>
  )
}

function CheckoutSuccessFlash(props: { onDismiss: () => void }) {
  const overview = useQuery(billingQueries.overview())
  const catalogue = useQuery(billingQueries.catalogue())
  const copy = checkoutSuccessCopy(overview.data, catalogue.data ?? null)
  return (
    <BillingFlash tone="success" title={copy.title} body={copy.body} onDismiss={props.onDismiss} />
  )
}

function BillingFlash(props: {
  tone: 'success' | 'error'
  title: string
  body: string
  onDismiss: () => void
}) {
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <Alert
      variant={props.tone === 'error' ? 'destructive' : 'default'}
      className={cn(
        props.tone === 'success' && 'border-emerald-500/30 bg-emerald-500/10 text-foreground'
      )}
    >
      <AlertTitle>{props.title}</AlertTitle>
      <AlertDescription>{props.body}</AlertDescription>
      <button
        type="button"
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
        onClick={() => {
          setOpen(false)
          props.onDismiss()
        }}
      >
        <XMarkIcon className="size-4" />
      </button>
    </Alert>
  )
}
