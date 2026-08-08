import { useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import type { BillingOverview } from '@/lib/server/domains/billing/billing.service'
import {
  openBillingPortalFn,
  reconcileBillingFn,
  startCheckoutFn,
} from '@/lib/server/functions/billing'
import { billingQueries } from '@/lib/client/queries/billing'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'

/**
 * The self-serve billing surface.
 *
 * Renders nothing when the deployment has no billing provider configured —
 * the server function returns null in that case, so this component is the
 * last of several places the default-off guarantee holds rather than the
 * only one.
 */
export function BillingSettings() {
  const { data } = useSuspenseQuery(billingQueries.overview())
  if (!data) return null
  return <BillingBody overview={data} />
}

function BillingBody({ overview }: { overview: BillingOverview }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<'checkout' | 'portal' | 'reconcile' | null>(null)
  const [targetPlan, setTargetPlan] = useState<string>(
    overview.purchasablePlans.find((plan) => plan.id !== overview.plan)?.id ??
      overview.purchasablePlans[0]?.id ??
      ''
  )
  // Off by default, deliberately. The Copilot seat count is derived from who
  // holds `copilot.use`, which on a workspace with no custom roles is
  // everyone — so an add-on that followed the count would be bought for the
  // whole team without anyone choosing it.
  const [buyCopilot, setBuyCopilot] = useState(false)
  const selectedPlan = overview.purchasablePlans.find((plan) => plan.id === targetPlan)

  async function run<T>(kind: typeof busy, action: () => Promise<T>, onDone: (value: T) => void) {
    setBusy(kind)
    try {
      onDone(await action())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Current plan"
        description="What this workspace is on, and what it is being billed for."
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void run(
                'reconcile',
                () => reconcileBillingFn(),
                () => {
                  void queryClient.invalidateQueries({ queryKey: billingQueries.all })
                  toast.success('Billing refreshed')
                }
              )
            }
          >
            <ArrowPathIcon className="size-4" />
            Refresh
          </Button>
        }
      >
        <div className="px-4 py-4 sm:px-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{overview.planName ?? 'No plan'}</span>
            {overview.status && (
              <Badge size="sm" shape="pill" variant={statusVariant(overview.status)}>
                {STATUS_LABELS[overview.status] ?? overview.status}
              </Badge>
            )}
            {overview.cancelAtPeriodEnd && (
              <Badge size="sm" shape="pill" variant="outline">
                Cancels at period end
              </Badge>
            )}
            {!overview.livemode && (
              <Badge size="sm" shape="pill" variant="outline">
                Test mode
              </Badge>
            )}
          </div>
          {overview.currentPeriodEnd && (
            <p className="text-[13px] text-muted-foreground">
              {overview.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} on{' '}
              {formatDate(overview.currentPeriodEnd)}.
            </p>
          )}
          <SeatSummary overview={overview} />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Change plan"
        description="Seat counts come from your team, so there is no quantity to type in."
      >
        <div className="px-4 py-4 sm:px-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-[13px] text-muted-foreground" htmlFor="billing-plan">
              Plan
            </label>
            <Select value={targetPlan} onValueChange={setTargetPlan}>
              <SelectTrigger size="sm" id="billing-plan" className="w-56">
                <SelectValue placeholder="Choose a plan" />
              </SelectTrigger>
              <SelectContent>
                {overview.purchasablePlans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={busy !== null || !targetPlan}
            onClick={() =>
              void run(
                'checkout',
                () =>
                  startCheckoutFn({
                    data: { plan: targetPlan as never, copilot: buyCopilot },
                  }),
                (result) => {
                  window.location.href = result.url
                }
              )
            }
          >
            {overview.hasSubscription ? 'Change plan' : 'Subscribe'}
            <ArrowTopRightOnSquareIcon className="size-4" />
          </Button>
          {overview.hasSubscription && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  'portal',
                  () => openBillingPortalFn({ data: {} }),
                  (result) => {
                    window.location.href = result.url
                  }
                )
              }
            >
              Payment method &amp; receipts
              <ArrowTopRightOnSquareIcon className="size-4" />
            </Button>
          )}
        </div>
        {selectedPlan?.copilotAddOn && (
          <div className="border-t border-border/50 px-4 py-3 sm:px-6">
            <label className="flex items-start gap-2.5">
              <Checkbox
                checked={buyCopilot}
                onCheckedChange={(next) => setBuyCopilot(next === true)}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span className="block text-[13px] font-medium">Add Copilot</span>
                <span className="block text-[13px] text-muted-foreground">
                  Billed per paid user.{' '}
                  {overview.seats.full === 1
                    ? 'You have 1 full seat.'
                    : `You have ${overview.seats.full} full seats.`}{' '}
                  Lite seats are not charged for Copilot.
                </span>
              </span>
            </label>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Included in your plan">
        <div className="px-4 py-4 sm:px-6 flex flex-wrap gap-1.5">
          {Object.entries(overview.entitlements).map(([key, granted]) => (
            <Badge
              key={key}
              size="sm"
              shape="pill"
              variant={granted ? 'secondary' : 'outline'}
              className={granted ? undefined : 'text-muted-foreground line-through'}
            >
              {ENTITLEMENT_LABELS[key] ?? key}
            </Badge>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Usage this period"
        description="Resolved AI outcomes, counted from your own conversations."
      >
        <div className="px-4 py-4 sm:px-6 flex flex-wrap gap-6">
          <Metric label="Resolved outcomes" value={overview.usage.total} />
          <Metric label="Reported to billing" value={overview.usage.reported} />
          <Metric label="Awaiting report" value={overview.usage.pending} />
        </div>
      </SettingsCard>

      {overview.paymentMethod && (
        <SettingsCard title="Payment method">
          <div className="px-4 py-4 sm:px-6 text-sm">
            {overview.paymentMethod.brand.toUpperCase()} ending {overview.paymentMethod.last4} ·
            expires {String(overview.paymentMethod.expMonth).padStart(2, '0')}/
            {overview.paymentMethod.expYear}
          </div>
        </SettingsCard>
      )}

      {overview.invoices.length > 0 && (
        <SettingsCard title="Invoices">
          <div className="divide-y divide-border/50">
            {overview.invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="px-4 py-2.5 sm:px-6 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-[13px] truncate">{invoice.number ?? invoice.id}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(invoice.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[13px] tabular-nums">
                    {formatMoney(invoice.total, invoice.currency)}
                  </span>
                  {invoice.status && (
                    <Badge size="sm" shape="pill" variant={statusVariant(invoice.status)}>
                      {invoice.status}
                    </Badge>
                  )}
                  {invoice.hostedUrl && (
                    <a
                      className="text-[13px] text-primary hover:underline"
                      href={invoice.hostedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </SettingsCard>
      )}
    </div>
  )
}

function SeatSummary({ overview }: { overview: BillingOverview }) {
  return (
    <div className="flex flex-wrap gap-6">
      <Metric label="Full seats" value={overview.seats.full} />
      <Metric label="Lite seats" value={overview.seats.lite} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Cancelled',
  paused: 'Paused',
}

const ENTITLEMENT_LABELS: Record<string, string> = {
  customDomain: 'Custom domains',
  sso: 'Single sign-on',
  aiAssistant: 'AI assistant',
  aiInsights: 'AI insights',
  workflows: 'Workflows',
  apiAccess: 'API access',
  mcpServer: 'MCP server',
  webhooks: 'Webhooks',
  auditLog: 'Audit log',
}

function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'active' || status === 'trialing' || status === 'paid') return 'secondary'
  if (status === 'past_due' || status === 'canceled' || status === 'open') return 'destructive'
  return 'outline'
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Provider totals are minor units. */
function formatMoney(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(total / 100)
  } catch {
    return `${(total / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}
