import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/settings/billing')({
  component: BillingPage,
})

function BillingPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="text-muted-foreground mt-2">Manage your subscription and billing settings.</p>
      <p className="text-sm text-muted-foreground mt-4">Coming soon...</p>
    </div>
  )
}
