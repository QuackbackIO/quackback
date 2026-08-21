import { useState } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon, CheckIcon } from '@heroicons/react/24/solid'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue, CustomerInvoice } from '@/lib/server/control-plane/client'
import { billingQueries } from '@/lib/client/queries/billing'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import { formatUsd } from '@/lib/shared/format-usd'
import { formatUsageLine } from '@/lib/shared/billing/plan-usage'
import { MENU_LABEL } from '@/components/ui/menu'

/** Workspace-local presentation of the control-plane billing projection. */
export function BillingSettings() {
  const { data: overview } = useSuspenseQuery(billingQueries.overview())
  const catalogue = useQuery(billingQueries.catalogue())
  const invoices = useQuery(billingQueries.invoices())
  const usage = useQuery(billingQueries.usage())
  if (!overview) return null
  return (
    <BillingPlansView
      overview={overview}
      catalogue={catalogue.data ?? null}
      catalogueError={catalogue.error instanceof Error ? catalogue.error.message : null}
      invoices={invoices.data ?? []}
      invoicesError={invoices.error instanceof Error ? invoices.error.message : null}
      usage={usage.data ?? []}
    />
  )
}

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Cancelled',
  paused: 'Paused',
}

export function BillingPlansView(props: {
  overview: BillingProjectionOverview
  catalogue: BillingCatalogue | null
  catalogueError: string | null
  invoices: CustomerInvoice[]
  invoicesError: string | null
  usage?: Array<{ key: string; label: string; used: number; limit: number | null }>
}) {
  const [period, setPeriod] = useState<'monthly' | 'annual'>('annual')
  const { overview, catalogue } = props

  return (
    <div className="space-y-8">
      <SettingsCard
        title="Current plan"
        description="Commercial access is kept up to date by Quackback Cloud."
        contentClassName="px-4 py-4 sm:px-6"
        action={overview.canManageBilling ? <PortalButton label="Manage billing" /> : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{overview.planName}</span>
          {overview.status && (
            <Badge size="sm" shape="pill" variant={statusVariant(overview.status)}>
              {STATUS_LABELS[overview.status] ?? overview.status}
            </Badge>
          )}
        </div>
        {overview.trialExpiresAt && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Pro trial ends on {formatDate(overview.trialExpiresAt)}.
          </p>
        )}
        {overview.renewalAt && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Renews on {formatDate(overview.renewalAt)}.
          </p>
        )}
        {overview.cancellationAt && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Access ends on {formatDate(overview.cancellationAt)}.
          </p>
        )}
      </SettingsCard>

      {props.usage && props.usage.length > 0 ? (
        <SettingsCard title="Usage" description="How much of this plan you are using.">
          <ul className="space-y-1.5 text-[13px]">
            {props.usage.map((line) => (
              <li key={line.key} className="font-mono tabular-nums">
                {formatUsageLine(line)}
              </li>
            ))}
          </ul>
        </SettingsCard>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Plans</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Prices come from Quackback Cloud. Upgrades apply immediately (pro-rata). Downgrades
              take effect at the end of the current billing period.
            </p>
          </div>
          <PeriodToggle
            value={period}
            discountMonths={catalogue?.annualDiscountMonths ?? 2}
            onChange={setPeriod}
          />
        </div>

        {props.catalogueError && (
          <p role="alert" className="text-[13px] text-destructive">
            Couldn’t load plans. {props.catalogueError}
          </p>
        )}

        {catalogue && (
          <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border/50 bg-card sm:grid-cols-2 xl:grid-cols-4">
            {catalogue.plans.map((plan, index) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                period={period}
                current={overview.plan === plan.id}
                canCheckout={
                  (overview.canUpgrade || overview.canManageBilling) &&
                  plan.id !== 'free' &&
                  overview.plan !== plan.id
                }
                paidChange={overview.canManageBilling && !overview.canUpgrade}
                index={index}
              />
            ))}
          </div>
        )}
      </section>

      <SettingsCard
        title="Invoices"
        description="Issued by Quackback Cloud. Open an invoice for the hosted copy."
        contentClassName="p-0"
      >
        {props.invoicesError ? (
          <p role="alert" className="px-4 py-4 text-[13px] text-destructive sm:px-6">
            Couldn’t load invoices. {props.invoicesError}
          </p>
        ) : props.invoices.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted-foreground sm:px-6">
            No invoices yet.
            {overview.canManageBilling ? ' Past invoices also appear in Manage billing.' : null}
          </p>
        ) : (
          <InvoiceTable invoices={props.invoices} />
        )}
      </SettingsCard>
    </div>
  )
}

function PlanCard(props: {
  plan: BillingCatalogue['plans'][number]
  period: 'monthly' | 'annual'
  current: boolean
  canCheckout: boolean
  paidChange: boolean
  index: number
}) {
  const { plan, period } = props
  const isAnnual = period === 'annual'
  const monthlyCents = isAnnual ? Math.round(plan.priceYearlyCents / 12) : plan.priceMonthlyCents
  const unit = plan.billedPer === 'seat' ? '/seat/mo' : '/mo'

  return (
    <article
      className={cn(
        'flex flex-col p-5',
        props.index > 0 && 'border-t border-border/50 sm:border-t-0',
        props.index % 2 === 1 && 'sm:border-l sm:border-border/50',
        props.index > 0 && 'xl:border-l xl:border-border/50',
        plan.recommended && 'bg-primary/5'
      )}
    >
      <div className="min-h-5">
        {props.current ? (
          <span className="inline-flex rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Current
          </span>
        ) : plan.recommended ? (
          <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tracking-wider text-primary uppercase">
            Best for most teams
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 text-sm font-semibold">{plan.name}</h3>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{plan.bestFor}</p>
      <p className="mt-5 flex items-baseline gap-1">
        <span className="text-[28px] font-semibold tracking-tight tabular-nums">
          {formatUsd(monthlyCents, 0)}
        </span>
        <span className="text-[13px] text-muted-foreground">{unit}</span>
      </p>
      {plan.id !== 'free' && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          {isAnnual ? `${formatUsd(plan.priceYearlyCents, 0)} billed yearly` : 'billed monthly'}
        </p>
      )}
      <ul className="mt-4 flex-1 space-y-2">
        {plan.highlights.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[13px] leading-snug">
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        {props.current ? (
          <Button size="sm" variant="outline" className="w-full" disabled>
            Current plan
          </Button>
        ) : props.canCheckout ? (
          <form method="post" action="/api/billing/session">
            <input type="hidden" name="action" value="checkout" />
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="billingPeriod" value={period} />
            <Button
              size="sm"
              type="submit"
              className="w-full"
              variant={plan.recommended ? 'default' : 'outline'}
            >
              {props.paidChange ? `Change to ${plan.name}` : `Choose ${plan.name}`}
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="w-full" disabled>
            Choose {plan.name}
          </Button>
        )}
      </div>
    </article>
  )
}

function PeriodToggle(props: {
  value: 'monthly' | 'annual'
  discountMonths: number
  onChange: (next: 'monthly' | 'annual') => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="inline-flex items-center rounded-full border border-border/50 bg-muted/30 p-0.5"
    >
      {(['annual', 'monthly'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={props.value === option}
          onClick={() => props.onChange(option)}
          className={cn(
            'inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium',
            props.value === option
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option === 'annual' ? 'Annual' : 'Monthly'}
          {option === 'annual' && (
            <span className="ms-1.5 text-[11px] font-semibold text-primary">
              {props.discountMonths} mo free
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function InvoiceTable({ invoices }: { invoices: CustomerInvoice[] }) {
  return (
    <table className="w-full caption-bottom text-[13px]">
      <thead>
        <tr className="border-b border-border/50">
          <th className={cn(MENU_LABEL, 'px-4 py-2 text-left font-medium sm:px-6')}>Date</th>
          <th className={cn(MENU_LABEL, 'px-4 py-2 text-left font-medium')}>Number</th>
          <th className={cn(MENU_LABEL, 'px-4 py-2 text-left font-medium')}>Amount</th>
          <th className={cn(MENU_LABEL, 'px-4 py-2 text-left font-medium')}>Status</th>
          <th className="px-4 py-2 sm:px-6" />
        </tr>
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <tr key={invoice.id} className="border-b border-border/50 last:border-0">
            <td className="px-4 py-2.5 sm:px-6">{formatDate(invoice.createdAt)}</td>
            <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
              {invoice.number ?? '—'}
            </td>
            <td className="px-4 py-2.5 tabular-nums">{formatUsd(invoice.amountCents, 2)}</td>
            <td className="px-4 py-2.5 capitalize">{invoice.status}</td>
            <td className="px-4 py-2.5 text-right sm:px-6">
              {invoice.hostedUrl ? (
                <a
                  href={invoice.hostedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
                >
                  View
                  <ArrowTopRightOnSquareIcon className="size-3.5" />
                </a>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PortalButton(props: { label: string; variant?: 'default' | 'outline'; wide?: boolean }) {
  return (
    <form method="post" action="/api/billing/session">
      <input type="hidden" name="action" value="portal" />
      <Button
        size="sm"
        type="submit"
        variant={props.variant ?? 'default'}
        className={props.wide ? 'w-full' : undefined}
      >
        {props.label}
        <ArrowTopRightOnSquareIcon className="size-3.5" />
      </Button>
    </form>
  )
}

function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'active' || status === 'trialing') return 'secondary'
  if (status === 'past_due' || status === 'canceled') return 'destructive'
  return 'outline'
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
