import { useState } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon, CheckIcon } from '@heroicons/react/24/solid'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue, CustomerInvoice } from '@/lib/server/control-plane/client'
import { billingQueries } from '@/lib/client/queries/billing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { cn } from '@/lib/shared/utils'
import { formatUsd } from '@/lib/shared/format-usd'
import { formatUsageLine } from '@/lib/shared/billing/plan-usage'
import {
  billingPlanAction,
  catalogueTrialDays,
  catalogueTrialedPlanIds,
  type BillingPlanAction,
  type PaidPlanId,
} from '@/lib/shared/billing/plan-action'

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
  const trialDays = catalogueTrialDays(catalogue)
  const trialedPlanIds = catalogueTrialedPlanIds(catalogue)
  const usageLines = (props.usage ?? []).map(formatUsageLine)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <StatusLine overview={overview} />
          {usageLines.length > 0 ? (
            <p className="font-mono text-[12px] text-muted-foreground tabular-nums">
              {usageLines.join(' · ')}
            </p>
          ) : null}
        </div>
        {overview.canManageBilling ? <PortalButton label="Manage billing" /> : null}
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Plans</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Upgrades apply immediately (pro-rata). Downgrades take effect at the end of the
              current billing period. A {trialDays}-day trial is available once per paid plan.
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
                trialDays={trialDays}
                action={billingPlanAction(plan.id, overview, trialedPlanIds)}
                trialActive={overview.trialActive && overview.plan === plan.id}
                index={index}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Previous invoices</h2>
        {props.invoicesError ? (
          <p role="alert" className="text-[13px] text-destructive">
            Couldn’t load invoices. {props.invoicesError}
          </p>
        ) : props.invoices.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No invoices yet.
            {overview.canManageBilling ? ' Past invoices also appear in Manage billing.' : null}
          </p>
        ) : (
          <InvoiceList invoices={props.invoices} />
        )}
      </section>
    </div>
  )
}

function StatusLine({ overview }: { overview: BillingProjectionOverview }) {
  const bits: string[] = []
  if (overview.trialActive && overview.trialExpiresAt) {
    bits.push(`${overview.planName} trial · ends ${formatDate(overview.trialExpiresAt)}`)
  } else if (overview.status) {
    bits.push(STATUS_LABELS[overview.status] ?? overview.status)
  }
  if (overview.cancellationAt) bits.push(`Access ends ${formatDate(overview.cancellationAt)}`)
  else if (overview.renewalAt) bits.push(`Renews ${formatDate(overview.renewalAt)}`)
  if (bits.length === 0) return null
  return <p className="text-[13px] text-muted-foreground">{bits.join(' · ')}</p>
}

function PlanCard(props: {
  plan: BillingCatalogue['plans'][number]
  period: 'monthly' | 'annual'
  trialDays: number
  action: BillingPlanAction
  trialActive: boolean
  index: number
}) {
  const { plan, period, action } = props
  const isAnnual = period === 'annual'
  const monthlyCents = isAnnual ? Math.round(plan.priceYearlyCents / 12) : plan.priceMonthlyCents
  const unit = plan.billedPer === 'seat' ? '/seat/mo' : '/mo'
  const current = action.kind === 'current'

  return (
    <article
      className={cn(
        'flex flex-col p-5',
        props.index > 0 && 'border-t border-border/50 sm:border-t-0',
        props.index % 2 === 1 && 'sm:border-l sm:border-border/50',
        props.index > 0 && 'xl:border-l xl:border-border/50',
        current && 'bg-muted/30 ring-1 ring-inset ring-foreground/15',
        plan.recommended && !current && 'bg-primary/5'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold">{plan.name}</h3>
            {props.trialActive ? (
              <Badge size="sm" shape="pill" variant="secondary">
                Trial
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{plan.bestFor}</p>
        </div>
        <p className="shrink-0 text-right">
          <span className="text-lg font-semibold tracking-tight tabular-nums">
            {formatUsd(monthlyCents, 0)}
          </span>
          <span className="block text-[12px] text-muted-foreground">{unit}</span>
        </p>
      </div>
      {plan.id !== 'free' && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          {isAnnual ? `${formatUsd(plan.priceYearlyCents, 0)} billed yearly` : 'billed monthly'}
        </p>
      )}
      <ul className="mt-4 flex-1 space-y-2">
        {plan.highlights.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[13px] leading-snug">
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <PlanActionButton
          action={action}
          planName={plan.name}
          trialDays={props.trialDays}
          period={period}
        />
      </div>
    </article>
  )
}

function PlanActionButton(props: {
  action: BillingPlanAction
  planName: string
  trialDays: number
  period: 'monthly' | 'annual'
}) {
  const { action } = props
  if (action.kind === 'current') {
    return (
      <Button size="sm" variant="outline" className="w-full" disabled>
        Current plan
      </Button>
    )
  }
  if (action.kind === 'unavailable') {
    return (
      <Button size="sm" variant="outline" className="w-full" disabled>
        {props.planName === 'Free' ? 'Downgrade' : `Choose ${props.planName}`}
      </Button>
    )
  }
  if (action.kind === 'trial') {
    return (
      <TrialButton planId={action.planId} planName={props.planName} trialDays={props.trialDays} />
    )
  }
  if (action.kind === 'downgrade') {
    return <DowngradeButton />
  }
  const label = action.kind === 'switch' ? `Switch to this plan` : `Subscribe to ${props.planName}`
  return (
    <form method="post" action="/api/billing/session">
      <input type="hidden" name="action" value="checkout" />
      <input type="hidden" name="planId" value={action.planId} />
      <input type="hidden" name="billingPeriod" value={props.period} />
      <Button size="sm" type="submit" className="w-full" variant="outline">
        {label}
      </Button>
    </form>
  )
}

function TrialButton(props: { planId: PaidPlanId; planName: string; trialDays: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="sm"
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        Start {props.trialDays}-day trial
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Start a ${props.trialDays}-day ${props.planName} trial?`}
        description={`You’ll have ${props.planName} for ${props.trialDays} days. When it ends you return to Free. Nothing is deleted. You can’t trial ${props.planName} again.`}
        confirmLabel={`Start ${props.planName} trial`}
        onConfirm={() => {
          const form = document.getElementById(`trial-${props.planId}`) as HTMLFormElement | null
          form?.requestSubmit()
        }}
      />
      <form
        id={`trial-${props.planId}`}
        method="post"
        action="/api/billing/trial"
        className="hidden"
      >
        <input type="hidden" name="planId" value={props.planId} />
      </form>
    </>
  )
}

function DowngradeButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="sm"
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        Downgrade
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Downgrade to Free?"
        description="Your workspace stays online. New work that exceeds Free limits will be refused; existing data is kept. A paid plan stays in force until the end of the current period. An active trial ends now."
        confirmLabel="Downgrade to Free"
        variant="destructive"
        onConfirm={() => {
          const form = document.getElementById('downgrade-free') as HTMLFormElement | null
          form?.requestSubmit()
        }}
      />
      <form id="downgrade-free" method="post" action="/api/billing/session" className="hidden">
        <input type="hidden" name="action" value="downgrade" />
        <input type="hidden" name="planId" value="free" />
      </form>
    </>
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

function InvoiceList({ invoices }: { invoices: CustomerInvoice[] }) {
  return (
    <ul className="divide-y divide-border/50 rounded-xl border border-border/50">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate font-medium">{invoice.number ?? 'Invoice'}</span>
          <span className="hidden text-muted-foreground sm:inline">
            {formatDate(invoice.createdAt)}
          </span>
          <span className="tabular-nums">{formatUsd(invoice.amountCents, 2)}</span>
          <span className="hidden capitalize text-muted-foreground md:inline">
            {invoice.status}
          </span>
          {invoice.hostedUrl ? (
            <a
              href={invoice.hostedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-muted-foreground hover:text-foreground"
              aria-label="View invoice"
            >
              <ArrowTopRightOnSquareIcon className="size-3.5" />
            </a>
          ) : (
            <span className="size-3.5" />
          )}
        </li>
      ))}
    </ul>
  )
}

function PortalButton(props: { label: string }) {
  return (
    <form method="post" action="/api/billing/session">
      <input type="hidden" name="action" value="portal" />
      <Button size="sm" type="submit" variant="outline">
        {props.label}
        <ArrowTopRightOnSquareIcon className="size-3.5" />
      </Button>
    </form>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
