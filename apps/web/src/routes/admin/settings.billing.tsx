import { createFileRoute, Outlet, Link, useLocation } from '@tanstack/react-router'
import { CreditCardIcon } from '@heroicons/react/24/outline'
import { isCloud } from '@/lib/features'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/admin/settings/billing')({
  component: BillingLayout,
})

const tabs = [
  { name: 'Overview', href: '/admin/settings/billing' },
  { name: 'Plans', href: '/admin/settings/billing/plans' },
  { name: 'Payment', href: '/admin/settings/billing/payment' },
  { name: 'Invoices', href: '/admin/settings/billing/invoices' },
]

function BillingLayout() {
  const location = useLocation()

  if (!isCloud()) {
    return <NotAvailableInSelfHosted />
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription, payment methods, and invoices
        </p>
      </div>

      {/* Tab Navigation */}
      <nav className="flex gap-1 border-b border-border">
        {tabs.map((tab) => {
          const isActive =
            tab.href === '/admin/settings/billing'
              ? location.pathname === '/admin/settings/billing' ||
                location.pathname === '/admin/settings/billing/'
              : location.pathname.startsWith(tab.href)

          return (
            <Link
              key={tab.href}
              to={tab.href}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              {tab.name}
            </Link>
          )
        })}
      </nav>

      {/* Tab Content */}
      <Outlet />
    </div>
  )
}

function NotAvailableInSelfHosted() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription and billing settings
        </p>
      </div>

      <div className="rounded-xl border border-border/50 bg-card shadow-sm">
        <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <CreditCardIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium text-foreground mb-1">
            Not available in self-hosted mode
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Billing is only available in the cloud version. Self-hosted deployments are free to use
            with all community features.
          </p>
        </div>
      </div>
    </div>
  )
}
