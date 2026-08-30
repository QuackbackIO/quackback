import { useState } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon, CheckIcon } from '@heroicons/react/24/solid'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue, CustomerInvoice } from '@/lib/server/control-plane/client'
import { billingQueries } from '@/lib/client/queries/billing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { cn } from '@/lib/shared/utils'
import { formatUsd } from '@/lib/shared/format-usd'
import { seatUnitCents } from './seat-price'
import { hasTopUpPackPrice } from './topup-price'
import {
  billingPlanAction,
  catalogueTrialDays,
  catalogueTrialedPlanIds,
  type BillingPlanAction,
  type PaidPlanId,
} from '@/lib/shared/billing/plan-action'
import { daysUntil } from '@/lib/shared/billing/trial-state'
import { AddSeatsDialog } from './add-seats-dialog'
import { RemoveSeatsDialog } from './remove-seats-dialog'
import { SubscribeDialog } from './subscribe-dialog'
import { TopUpDialog } from './topup-dialog'
import { UsageMeter } from './usage-meter'
import { TrialExpiredBilling } from './trial-expired-billing'
import { FreeDowngradeDialog } from './free-downgrade-dialog'

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
  const [addSeatsOpen, setAddSeatsOpen] = useState(false)
  const [removeSeatsOpen, setRemoveSeatsOpen] = useState(false)
  const [topupMeter, setTopupMeter] = useState<'ai' | 'email' | null>(null)
  const [subscribePlanId, setSubscribePlanId] = useState<PaidPlanId | null>(null)
  const { overview, catalogue } = props
  const subscribePlan = catalogue?.plans.find((plan) => plan.id === subscribePlanId)
  const trialDays = catalogueTrialDays(catalogue)
  const trialedPlanIds = catalogueTrialedPlanIds(catalogue)
  const checkoutQuantity = Math.max(overview.seats?.used ?? 1, 1)
  const currentCataloguePlan = catalogue?.plans.find((plan) => plan.id === overview.plan)
  const grandfatheredFlat =
    currentCataloguePlan?.billedPer === 'workspace' && overview.plan !== 'free'

  if (overview.trialEnded) {
    return (
      <TrialExpiredBilling
        overview={overview}
        catalogue={catalogue}
        catalogueError={props.catalogueError}
      />
    )
  }

  return (
    <div className="space-y-6">
      <CurrentPlanCard
        overview={overview}
        catalogue={catalogue}
        onAddSeats={() => setAddSeatsOpen(true)}
        onRemoveSeats={() => setRemoveSeatsOpen(true)}
        onSubscribe={setSubscribePlanId}
      />

      <UsageCard
        overview={overview}
        catalogue={catalogue}
        usage={props.usage ?? []}
        onTopUp={setTopupMeter}
      />

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Plans</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Moving up applies now, billed pro-rata. Moving to a lower plan waits until the end of
              the current period. You can try each paid plan once for {trialDays} days.
              {grandfatheredFlat ? ' Switching plans moves you onto per-seat pricing.' : null}
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
                checkoutQuantity={checkoutQuantity}
                subscribeIsContinuation={Boolean(overview.trialActive || overview.trialEnded)}
                onSubscribe={setSubscribePlanId}
              />
            ))}
          </div>
        )}
      </section>

      <AddOnsCard
        catalogue={catalogue}
        period={period}
        hideBranding={overview.hideBranding}
        canPurchase={overview.canUpgrade || overview.canManageBilling}
      />

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

      {addSeatsOpen ? <AddSeatsDialog open onOpenChange={setAddSeatsOpen} /> : null}
      {removeSeatsOpen ? <RemoveSeatsDialog open onOpenChange={setRemoveSeatsOpen} /> : null}
      {subscribePlan && subscribePlan.id !== 'free' ? (
        <SubscribeDialog
          open
          plan={subscribePlan}
          endsTrial={Boolean(overview.trialActive || overview.trialEnded)}
          minSeats={checkoutQuantity}
          discountMonths={catalogue?.annualDiscountMonths ?? 2}
          period={period}
          onOpenChange={(open) => {
            if (!open) setSubscribePlanId(null)
          }}
        />
      ) : null}
      {topupMeter ? (
        <TopUpDialog
          open
          meter={topupMeter}
          onOpenChange={(open) => {
            if (!open) setTopupMeter(null)
          }}
        />
      ) : null}
    </div>
  )
}

function CurrentPlanCard(props: {
  overview: BillingProjectionOverview
  catalogue: BillingCatalogue | null
  onAddSeats: () => void
  onRemoveSeats: () => void
  onSubscribe: (planId: PaidPlanId) => void
}) {
  const { overview, catalogue } = props
  const plan = catalogue?.plans.find((entry) => entry.id === overview.plan)
  const purchased = overview.seats?.purchased ?? null
  const showSeats = purchased != null
  const trialPlanName =
    overview.trialPlanName && overview.trialPlanName !== 'Free' ? overview.trialPlanName : null
  const subscribePlanId = overview.trialPlanId ?? (overview.plan !== 'free' ? overview.plan : null)
  const canSubscribe = Boolean(
    overview.canUpgrade &&
    subscribePlanId &&
    (overview.trialActive || overview.trialEnded) &&
    catalogue?.plans.some((entry) => entry.id === subscribePlanId)
  )
  const daysLeft =
    overview.trialActive && overview.trialExpiresAt ? daysUntil(overview.trialExpiresAt) : null
  const statusLabel = overview.trialActive
    ? 'Trial'
    : overview.trialEnded
      ? 'Trial ended'
      : overview.status
        ? (STATUS_LABELS[overview.status] ?? overview.status)
        : null
  const perSeat = plan ? seatUnitCents(plan, null) : 0
  const renewalBits: string[] = []
  if (overview.trialActive && overview.trialExpiresAt) {
    const left =
      daysLeft === null
        ? ''
        : daysLeft === 0
          ? ' (ends today)'
          : ` (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left)`
    renewalBits.push(`Trial ends ${formatDate(overview.trialExpiresAt)}${left}`)
  } else if (overview.trialEnded && overview.trialExpiresAt) {
    renewalBits.push(
      trialPlanName
        ? `Your ${trialPlanName} trial ended ${formatDate(overview.trialExpiresAt)}. Everything you built is still here.`
        : `Your trial ended ${formatDate(overview.trialExpiresAt)}. Everything you built is still here.`
    )
  } else if (overview.cancellationAt) {
    renewalBits.push(`Paid through ${formatDate(overview.cancellationAt)}`)
  } else if (overview.renewalAt) {
    renewalBits.push(`Renews ${formatDate(overview.renewalAt)}`)
  }
  if (showSeats && plan && plan.billedPer === 'seat') {
    renewalBits.push(`${purchased} seats × ${formatUsd(perSeat, 0)}/seat`)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/50 bg-card">
      <div className="flex items-start justify-between gap-3 px-6 py-5">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{overview.planName}</h2>
            {statusLabel ? (
              <Badge size="sm" shape="pill" variant="secondary">
                {statusLabel}
              </Badge>
            ) : null}
          </div>
          {renewalBits.length > 0 ? (
            <p className="text-[13px] text-muted-foreground">{renewalBits.join(' · ')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canSubscribe && subscribePlanId ? (
            <Button size="sm" type="button" onClick={() => props.onSubscribe(subscribePlanId)}>
              Continue with {trialPlanName ?? 'a paid plan'}
            </Button>
          ) : null}
          {overview.canManageBilling ? <PortalButton label="Manage billing" /> : null}
        </div>
      </div>
      {overview.trialActive ? (
        <TrialSeatsRow overview={overview} />
      ) : overview.trialEnded ? (
        <EndedSeatsRow overview={overview} />
      ) : showSeats ? (
        <SeatsBlock
          overview={overview}
          purchased={purchased}
          onAddSeats={props.onAddSeats}
          onRemoveSeats={props.onRemoveSeats}
        />
      ) : null}
    </section>
  )
}

function TrialSeatsRow(props: { overview: BillingProjectionOverview }) {
  const seats = props.overview.seats
  const used = seats?.used ?? 0
  const members = seats?.members ?? used
  const pending = seats?.pending ?? 0
  return (
    <div className="border-t border-border/50 px-6 py-5">
      <p className="text-[13px] text-muted-foreground">
        Uncapped during your trial · {members} {members === 1 ? 'member' : 'members'} · {pending}{' '}
        pending {pending === 1 ? 'invite' : 'invites'} · checkout starts at your current {used}{' '}
        {used === 1 ? 'seat' : 'seats'}
      </p>
    </div>
  )
}

function EndedSeatsRow(props: { overview: BillingProjectionOverview }) {
  const seats = props.overview.seats
  const used = seats?.used ?? 0
  const cap = 1
  return (
    <div className="flex flex-col gap-2.5 border-t border-border/50 px-6 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13px] font-medium">Seats</div>
        <div className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {used} of {cap} used
        </div>
      </div>
      <Progress value={used} max={cap} />
      <p className="text-[12px] text-muted-foreground">
        Everyone keeps access. New invites pause until you continue with a paid plan.
      </p>
    </div>
  )
}

function SeatsBlock(props: {
  overview: BillingProjectionOverview
  purchased: number
  onAddSeats: () => void
  onRemoveSeats: () => void
}) {
  const seats = props.overview.seats
  const used = seats?.used ?? 0
  const members = seats?.members ?? used
  const pending = seats?.pending ?? 0
  const available = Math.max(0, props.purchased - used)
  return (
    <div className="flex flex-col gap-2.5 border-t border-border/50 px-6 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13px] font-medium">Seats</div>
        <div className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {used} of {props.purchased} used
        </div>
      </div>
      <Progress value={used} max={Math.max(props.purchased, 1)} />
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] text-muted-foreground">
          {members} {members === 1 ? 'member' : 'members'} · {pending} pending{' '}
          {pending === 1 ? 'invite' : 'invites'} · {available} {available === 1 ? 'seat' : 'seats'}{' '}
          available
        </div>
        {props.overview.canManageBilling ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={props.purchased <= used}
              onClick={props.onRemoveSeats}
            >
              Remove seats
            </Button>
            <Button type="button" size="sm" onClick={props.onAddSeats}>
              Add seats
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Each member or pending invite uses a seat.
      </p>
    </div>
  )
}

/** Seats live on the current-plan card; AI tokens are the dollar AI meter. */
const USAGE_CARD_SKIP = new Set(['maxTeamSeats', 'aiTokensPerMonth'])

function usageMeterLabel(line: { key: string; label: string }): string {
  if (line.key === 'emailsPerMonth') return 'Emails'
  if (line.key === 'apiRequestsPerMonth') return 'API requests'
  return line.label.charAt(0).toUpperCase() + line.label.slice(1)
}

function usageMeterDescription(key: string): string | undefined {
  switch (key) {
    case 'emailsPerMonth':
      return 'Changelog and status-page mail this month.'
    case 'apiRequestsPerMonth':
      return 'REST API calls this month.'
    case 'maxStatusComponents':
      return 'Active components on the status page.'
    case 'maxCustomRoles':
      return 'Roles beyond Owner, Admin, and Member.'
    case 'maxSendingDomains':
      return 'Authenticated domains for outbound mail.'
    case 'maxBoards':
      return 'Public and private boards.'
    case 'maxPosts':
      return 'Feedback posts across all boards.'
    default:
      return undefined
  }
}

function UsageCard(props: {
  overview: BillingProjectionOverview
  catalogue: BillingCatalogue | null
  usage: Array<{ key: string; label: string; used: number; limit: number | null }>
  onTopUp: (meter: 'ai' | 'email') => void
}) {
  const emails = props.usage.find((line) => line.key === 'emailsPerMonth')
  const api = props.usage.find((line) => line.key === 'apiRequestsPerMonth')
  const inventory = props.usage.filter(
    (line) =>
      line.limit != null &&
      !USAGE_CARD_SKIP.has(line.key) &&
      line.key !== 'emailsPerMonth' &&
      line.key !== 'apiRequestsPerMonth'
  )
  const ai = props.overview.ai
  const canTopUp = props.overview.canManageBilling
  const hasAi = ai != null && (ai.includedCents > 0 || ai.extraCents > 0)
  const hasEmails = emails != null && emails.limit != null
  const hasApi = api != null && api.limit != null
  if (!hasAi && !hasEmails && !hasApi && inventory.length === 0) return null

  const reset = nextMonthResetLabel()
  const meterUsed = ai ? Math.min(ai.usedCents, ai.includedCents) : 0
  const hasMonthly = hasAi || hasEmails || hasApi

  return (
    <section className="overflow-hidden rounded-xl border border-border/50 bg-card">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <h2 className="text-base font-semibold">Usage</h2>
        {hasMonthly ? (
          <div className="text-[12px] text-muted-foreground">Monthly meters reset {reset}</div>
        ) : null}
      </div>
      <div className="divide-y divide-border/50">
        {hasAi && ai ? (
          <div className="px-6 py-4">
            <UsageMeter
              label="AI usage"
              description={
                ai.extraCents > 0
                  ? `${formatUsd(ai.includedCents, 0)}/mo included, used first. ${formatUsd(ai.extraCents, 2)} extra credit.`
                  : `${formatUsd(ai.includedCents, 0)}/mo included, used first.`
              }
              valueText={`${formatUsd(meterUsed, 2)} of ${formatUsd(ai.includedCents, 2)}`}
              used={meterUsed}
              limit={ai.includedCents}
              action={
                canTopUp && hasTopUpPackPrice(props.catalogue?.aiTopUpPackCents) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => props.onTopUp('ai')}
                  >
                    Top up
                  </Button>
                ) : null
              }
            />
          </div>
        ) : null}
        {hasEmails && emails && emails.limit != null ? (
          <div className="px-6 py-4">
            <UsageMeter
              label="Emails"
              description={usageMeterDescription('emailsPerMonth')}
              valueText={`${emails.used.toLocaleString()} of ${emails.limit.toLocaleString()}`}
              used={emails.used}
              limit={emails.limit}
              action={
                canTopUp &&
                emails.limit != null &&
                hasTopUpPackPrice(props.catalogue?.emailTopUpPackCents) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => props.onTopUp('email')}
                  >
                    Top up
                  </Button>
                ) : null
              }
            />
          </div>
        ) : null}
        {hasApi && api && api.limit != null ? (
          <div className="px-6 py-4">
            <UsageMeter
              label="API requests"
              description={usageMeterDescription('apiRequestsPerMonth')}
              valueText={`${api.used.toLocaleString()} of ${api.limit.toLocaleString()}`}
              used={api.used}
              limit={api.limit}
            />
          </div>
        ) : null}
        {inventory.map((line) =>
          line.limit != null ? (
            <div key={line.key} className="px-6 py-4">
              <UsageMeter
                label={usageMeterLabel(line)}
                description={usageMeterDescription(line.key)}
                valueText={`${line.used.toLocaleString()} of ${line.limit.toLocaleString()}`}
                used={line.used}
                limit={line.limit}
              />
            </div>
          ) : null
        )}
      </div>
    </section>
  )
}

function AddOnsCard(props: {
  catalogue: BillingCatalogue | null
  period: 'monthly' | 'annual'
  hideBranding: boolean
  canPurchase: boolean
}) {
  const branding = props.catalogue?.brandingRemoval
  if (!branding) return null
  const price =
    props.period === 'annual'
      ? `${formatUsd(branding.annualCents, 0)}/yr`
      : `${formatUsd(branding.monthlyCents, 0)}/mo`
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Add-ons</h2>
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium">Remove Quackback branding</div>
            <div className="text-[12px] text-muted-foreground">
              Hide &quot;Powered by Quackback&quot; on the portal, widget, and emails. {price}.
            </div>
          </div>
          {props.hideBranding ? (
            <form method="post" action="/api/billing/session">
              <input type="hidden" name="action" value="branding-remove" />
              <Button type="submit" size="sm" variant="outline">
                Remove
              </Button>
            </form>
          ) : props.canPurchase ? (
            <form method="post" action="/api/billing/session">
              <input type="hidden" name="action" value="branding" />
              <input type="hidden" name="billingPeriod" value={props.period} />
              <Button type="submit" size="sm" variant="outline">
                Add
              </Button>
            </form>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled>
              Add
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

function nextMonthResetLabel(): string {
  const date = new Date()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function PlanCard(props: {
  plan: BillingCatalogue['plans'][number]
  period: 'monthly' | 'annual'
  trialDays: number
  action: BillingPlanAction
  trialActive: boolean
  index: number
  checkoutQuantity: number
  subscribeIsContinuation: boolean
  onSubscribe: (planId: PaidPlanId) => void
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
          checkoutQuantity={props.checkoutQuantity}
          subscribeIsContinuation={props.subscribeIsContinuation}
          onSubscribe={props.onSubscribe}
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
  checkoutQuantity: number
  subscribeIsContinuation: boolean
  onSubscribe: (planId: PaidPlanId) => void
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
        {props.planName === 'Free' ? 'Switch to Free' : `Choose ${props.planName}`}
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
  if (action.kind === 'subscribe') {
    return (
      <Button
        size="sm"
        type="button"
        className="w-full"
        variant="outline"
        onClick={() => props.onSubscribe(action.planId)}
      >
        {props.subscribeIsContinuation
          ? `Continue with ${props.planName}`
          : `Subscribe to ${props.planName}`}
      </Button>
    )
  }
  return (
    <form method="post" action="/api/billing/session">
      <input type="hidden" name="action" value="checkout" />
      <input type="hidden" name="planId" value={action.planId} />
      <input type="hidden" name="billingPeriod" value={props.period} />
      <input type="hidden" name="quantity" value={String(props.checkoutQuantity)} />
      <Button size="sm" type="submit" className="w-full" variant="outline">
        Switch to this plan
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
        title={`Try ${props.planName} for ${props.trialDays} days?`}
        description={`You’ll have ${props.planName} for ${props.trialDays} days. When it ends you continue on Free with everything you have built. Each paid plan can be tried once.`}
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
        Switch to Free
      </Button>
      {open ? <FreeDowngradeDialog open onOpenChange={setOpen} /> : null}
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
