import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { DocumentTextIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { billingQueries } from '@/lib/queries/billing'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/admin/settings/billing/invoices')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(billingQueries.invoices())
  },
  component: InvoicesPage,
})

function InvoicesPage() {
  const { data: invoices } = useSuspenseQuery(billingQueries.invoices())

  if (invoices.length === 0) {
    return (
      <SettingsCard title="Invoice History" description="Your past invoices and payments">
        <div className="text-center py-12">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <DocumentTextIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="font-medium">No invoices yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Invoices will appear here after your first payment
          </p>
        </div>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard title="Invoice History" description="Your past invoices and payments">
      <div className="divide-y divide-border/50">
        {invoices.map((invoice) => (
          <div
            key={invoice.id}
            className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
          >
            <div>
              <p className="text-sm font-medium">{formatDate(invoice.createdAt)}</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatCurrency(invoice.amountPaid, invoice.currency)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <InvoiceStatusBadge status={invoice.status} />
              {invoice.pdfUrl && (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={invoice.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Download PDF"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    paid: {
      label: 'Paid',
      className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    },
    open: {
      label: 'Open',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    draft: {
      label: 'Draft',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    },
    void: {
      label: 'Void',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    },
    uncollectible: {
      label: 'Failed',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
  }

  const variant = variants[status] || variants.draft

  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', variant.className)}>
      {variant.label}
    </span>
  )
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCurrency(amountInCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountInCents / 100)
}
