'use client'

import { FileText, Download, ExternalLink } from 'lucide-react'

interface Invoice {
  id: string
  number: string | null
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
  amountPaid: number
  currency: string
  created: string
  pdfUrl: string | null
  hostedInvoiceUrl: string | null
}

interface InvoiceHistoryProps {
  invoices: Invoice[]
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

function getStatusBadge(status: Invoice['status']) {
  const styles: Record<Invoice['status'], string> = {
    paid: 'bg-green-500/10 text-green-600',
    open: 'bg-amber-500/10 text-amber-600',
    draft: 'bg-muted text-muted-foreground',
    void: 'bg-muted text-muted-foreground',
    uncollectible: 'bg-red-500/10 text-red-600',
  }

  const labels: Record<Invoice['status'], string> = {
    paid: 'Paid',
    open: 'Open',
    draft: 'Draft',
    void: 'Void',
    uncollectible: 'Uncollectible',
  }

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

export function BillingInvoiceHistory({ invoices }: InvoiceHistoryProps) {
  if (invoices.length === 0) {
    return null
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border/50">
        <h2 className="font-medium">Invoice History</h2>
      </div>
      <div className="divide-y divide-border/50">
        {invoices.map((invoice) => (
          <div key={invoice.id} className="px-6 py-4 flex items-center gap-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted shrink-0">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {invoice.number || `Invoice ${invoice.id.slice(-8)}`}
                </span>
                {getStatusBadge(invoice.status)}
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(invoice.created).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-medium">
                {formatCurrency(invoice.amountPaid, invoice.currency)}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {invoice.pdfUrl && (
                <a
                  href={invoice.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                  title="Download PDF"
                >
                  <Download className="h-4 w-4" />
                </a>
              )}
              {invoice.hostedInvoiceUrl && (
                <a
                  href={invoice.hostedInvoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                  title="View Invoice"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
