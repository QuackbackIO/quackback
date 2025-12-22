import { requireTenant } from '@/lib/tenant'
import { isSelfHosted } from '@quackback/domain/features'
import { CreditCard, Server, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { BillingClient } from './billing-client'
import { getUsageCounts } from '@/lib/db'
import {
  getCustomerInvoices,
  getDefaultPaymentMethod,
  isStripeConfigured,
  type InvoiceListItem,
  type PaymentMethodInfo,
} from '@quackback/ee/billing'

interface BillingPageProps {
  params?: Promise<{}>
  searchParams: Promise<{ success?: string; canceled?: string }>
}

export default async function BillingPage({ params, searchParams }: BillingPageProps) {
  // Settings is validated in root layout
  const { success, canceled } = await searchParams
  const { settings } = await requireTenant()

  // Show "not available" message for self-hosted deployments
  if (isSelfHosted()) {
    return (
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Server className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Billing</h1>
            <p className="text-sm text-muted-foreground">
              Not available for self-hosted deployments
            </p>
          </div>
        </div>

        {/* Explanation Card */}
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="font-medium mb-2">Self-Hosted Mode</h2>
          <p className="text-sm text-muted-foreground mb-4">
            You are running Quackback in self-hosted mode. Billing and subscription management are
            only available for the managed cloud version.
          </p>
          <p className="text-sm text-muted-foreground">
            Self-hosted deployments have access to all features without subscription restrictions.
          </p>
        </div>

        {/* Back to Settings */}
        <Link href="/admin/settings/team">
          <Button variant="outline">Back to Settings</Button>
        </Link>
      </div>
    )
  }

  // Cloud mode - fetch usage data
  const usageCounts = await getUsageCounts()

  // For cloud mode, we'd need to get subscription from a billing service
  // For now, show the billing client with just usage info
  const subscriptionData = null

  // Fetch Stripe customer data (invoices, payment method) - not available in OSS
  const invoices: InvoiceListItem[] = []
  const paymentMethod: PaymentMethodInfo | null = null

  // Serialize data for client component
  const serializedInvoices = invoices.map((inv) => ({
    ...inv,
    created: inv.created.toISOString(),
    periodStart: inv.periodStart.toISOString(),
    periodEnd: inv.periodEnd.toISOString(),
  }))

  // Cloud mode - show full billing page
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage billing for {settings.name}</p>
        </div>
      </div>

      {/* Success/Canceled Messages */}
      {success === 'true' && (
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 flex items-start gap-3">
          <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-green-600">Subscription successful!</p>
            <p className="text-sm text-green-600/80">
              Your subscription has been activated. Thank you for choosing Quackback!
            </p>
          </div>
        </div>
      )}
      {canceled === 'true' && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-600">Checkout canceled</p>
            <p className="text-sm text-amber-600/80">No changes were made to your subscription.</p>
          </div>
        </div>
      )}

      {/* Billing Client Component */}
      <BillingClient
        workspaceId={settings.id}
        subscription={subscriptionData}
        usage={usageCounts}
        invoices={serializedInvoices}
        paymentMethod={paymentMethod}
      />
    </div>
  )
}
