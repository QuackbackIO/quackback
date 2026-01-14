import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { CreditCardIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { createPortalSessionFn } from '@/lib/server-functions/billing'
import { billingQueries } from '@/lib/queries/billing'

export const Route = createFileRoute('/admin/settings/billing/payment')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(billingQueries.overview())
  },
  component: PaymentPage,
})

function PaymentPage() {
  const [isLoading, setIsLoading] = useState(false)
  const { data } = useSuspenseQuery(billingQueries.overview())

  const hasSubscription = data.subscription?.stripeCustomerId

  const handleManagePayment = async () => {
    setIsLoading(true)
    try {
      const result = await createPortalSessionFn({ data: {} })
      window.location.href = result.url
    } catch (error) {
      console.error('Failed to create portal session:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Payment Method"
        description="Manage your payment methods and billing information"
      >
        {hasSubscription ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <CreditCardIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="font-medium">Managed by Stripe</p>
                <p className="text-sm text-muted-foreground">
                  Securely update your card or billing details
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleManagePayment} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Manage'}
              <ArrowTopRightOnSquareIcon className="h-4 w-4 ml-2" />
            </Button>
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <CreditCardIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">No payment method on file</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upgrade to a paid plan to add a payment method
            </p>
          </div>
        )}
      </SettingsCard>

      {hasSubscription && (
        <SettingsCard
          title="Billing Portal"
          description="Access your complete billing history and settings"
        >
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">Update payment methods</p>
              <p className="text-xs text-muted-foreground">Add or remove cards</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">Download invoices</p>
              <p className="text-xs text-muted-foreground">PDF receipts for all payments</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">Update billing info</p>
              <p className="text-xs text-muted-foreground">Address and tax details</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">Cancel subscription</p>
              <p className="text-xs text-muted-foreground">Manage your plan</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleManagePayment} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Open Billing Portal'}
            <ArrowTopRightOnSquareIcon className="h-4 w-4 ml-2" />
          </Button>
        </SettingsCard>
      )}
    </div>
  )
}
