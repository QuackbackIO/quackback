import { requireTenantBySlug } from '@/lib/tenant'
import { CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default async function BillingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { organization } = await requireTenantBySlug(orgSlug)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage billing for {organization.name}</p>
        </div>
      </div>

      {/* Current Plan */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Current Plan</h2>
        <p className="text-sm text-muted-foreground mb-4">You are currently on the free plan</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold text-foreground">Free</p>
            <p className="text-sm text-muted-foreground">$0/month</p>
          </div>
          <Button>Upgrade plan</Button>
        </div>
      </div>

      {/* Payment Method */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Payment Method</h2>
        <p className="text-sm text-muted-foreground mb-4">Manage your payment details</p>
        <div className="rounded-lg bg-muted/30 p-4 mb-4">
          <p className="text-sm text-muted-foreground">No payment method on file</p>
        </div>
        <Button variant="outline">Add payment method</Button>
      </div>

      {/* Billing History */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Billing History</h2>
        <p className="text-sm text-muted-foreground mb-4">View past invoices</p>
        <div className="rounded-lg bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">No billing history available</p>
        </div>
      </div>
    </div>
  )
}
