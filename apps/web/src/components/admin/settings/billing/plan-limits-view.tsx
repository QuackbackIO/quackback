import { useState, type ReactNode } from 'react'
import { CheckIcon, ChevronRightIcon } from '@heroicons/react/24/solid'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { DOMAINS_PAGE_PERMISSIONS } from '@/lib/shared/domains-permissions'
import { checkoutPath, isPaidPlanId } from '@/lib/shared/billing/checkout-path'
import {
  capConsequence,
  featureConsequence,
  infoRowNote,
  isPlanLimitsOver,
  keepEverythingLines,
  planLimitsShownDay,
} from '@/lib/shared/billing/plan-limits-copy'
import { daysUntil } from '@/lib/shared/billing/trial-state'
import type { PlanCapKey } from '@/lib/shared/billing/plan-downgrade'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useLocalDateFormatter } from '@/components/ui/local-date'
import {
  DEADLINE_FORMAT,
  INLINE_DATE_FORMAT,
} from '@/components/admin/plan-limits/plan-limits-banner'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { PlanLimitIssues, type PlanLimitRow } from './plan-limit-issues'
import {
  PlanLimitsChooserDialog,
  chooserAvailable,
  type PlanLimitsChooserKind,
} from './plan-limits-choosers'

/** The chooser for each cap that has one, with its button label. */
const CHOOSER_FOR: Partial<Record<PlanCapKey, { kind: PlanLimitsChooserKind; label: string }>> = {
  maxBoards: { kind: 'board', label: 'Choose which board stays open' },
  maxTeamSeats: { kind: 'seats', label: 'Choose who keeps a seat' },
  maxStatusComponents: { kind: 'statusComponents', label: 'Choose what shows on your status page' },
  maxSendingDomains: { kind: 'sendingDomains', label: 'Choose which domain keeps sending' },
}

/** The page that fixes each cap, and who may open it. */
const MANAGE: Partial<Record<PlanCapKey, { label: string; anyOf: readonly PermissionKey[] }>> = {
  maxBoards: { label: 'Manage boards', anyOf: [PERMISSIONS.BOARD_MANAGE] },
  maxTeamSeats: { label: 'Manage members', anyOf: [PERMISSIONS.MEMBER_MANAGE] },
  maxStatusComponents: { label: 'Manage status page', anyOf: [PERMISSIONS.STATUS_PAGE_MANAGE] },
  maxCustomRoles: { label: 'Manage roles', anyOf: [PERMISSIONS.ROLE_MANAGE] },
  maxSendingDomains: { label: 'Manage domains', anyOf: DOMAINS_PAGE_PERMISSIONS },
  maxHelpCenterLocales: { label: 'Manage languages', anyOf: [PERMISSIONS.HELP_CENTER_MANAGE] },
}

/** What is never taken away by a lower plan. */
const KEEPS_WORKING = [
  'All posts, votes and comments',
  'Inbound email',
  'Status subscribers',
  'Copilot drafts',
]

const PLAN_ORDER = ['free', 'pro', 'business', 'enterprise'] as const

/** The plan that keeps everything: the one before the drop, else the next one up. */
export function keepEverythingPlan(
  plan: string | null,
  fromPlan: string | null
): (typeof PLAN_ORDER)[number] | null {
  const rank = (id: string | null) => (id ? PLAN_ORDER.indexOf(id as never) : -1)
  const current = rank(plan)
  if (current < 0) return null
  if (rank(fromPlan) > current) return fromPlan as (typeof PLAN_ORDER)[number]
  return PLAN_ORDER[current + 1] ?? null
}

/**
 * The Plan limits page: the deadline, every cap over the plan with its fixes,
 * what pauses, what keeps working, and the plan that keeps everything.
 */
export function PlanLimitsView(props: {
  limits: PlanLimitsPage
  permissions: ReadonlySet<PermissionKey>
  catalogue: BillingCatalogue | null
}) {
  const { limits } = props
  const format = useLocalDateFormatter()
  const [chooser, setChooser] = useState<PlanLimitsChooserKind | null>(null)

  if (!isPlanLimitsOver(limits) || !limits.graceEndsAt) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {limits.planName
          ? `Your workspace fits the ${limits.planName} plan.`
          : 'Your workspace fits its plan.'}
      </p>
    )
  }

  const grace = limits.phase === 'grace'
  const plan = limits.planName ?? 'current'
  const tense = limits.phase
  const day = planLimitsShownDay(limits)
  const date = format(day, DEADLINE_FORMAT)
  const shortDate = format(day, INLINE_DATE_FORMAT)

  const can = (anyOf: readonly PermissionKey[]) => anyOf.some((p) => props.permissions.has(p))
  const issueRows: PlanLimitRow[] = limits.issues.map((issue) => {
    const choose = CHOOSER_FOR[issue.key]
    const manage = MANAGE[issue.key]
    const actions: ReactNode[] = []
    if (choose && chooserAvailable(choose.kind, limits)) {
      actions.push(
        <Button
          key="choose"
          size="sm"
          variant="outline"
          type="button"
          onClick={() => setChooser(choose.kind)}
        >
          {choose.label}
        </Button>
      )
    }
    if (manage && can(manage.anyOf)) {
      actions.push(
        <Button key="manage" size="sm" variant="ghost" asChild>
          <a href={issue.href}>{manage.label}</a>
        </Button>
      )
    }
    return {
      key: issue.key,
      used: issue.used,
      cap: issue.cap,
      status: 'over',
      note: capConsequence(issue.key, issue.used - issue.cap, tense, shortDate, plan),
      actions: actions.length > 0 ? actions : undefined,
    }
  })
  const fixedRows: PlanLimitRow[] = limits.fixedIssues.map((row) => ({ ...row, status: 'fixed' }))
  const infoRows: PlanLimitRow[] = limits.infoRows.map((row) => ({
    key: row.key,
    used: row.used,
    cap: row.cap,
    status: 'info',
    note: infoRowNote(row),
  }))
  const total = issueRows.length + fixedRows.length
  const target = keepEverythingPlan(limits.plan, limits.fromPlan)
  const targetName = target ? planName(target, props.catalogue) : null
  const canChoose = limits.canManageBilling && target !== null && isPaidPlanId(target)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-8">
        <section
          data-settings-card=""
          data-plan-limits-deadline={tense}
          className="space-y-3 rounded-xl border bg-card px-5 py-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {grace ? `Fix by ${date}` : `Paused since ${date}`}
            </h2>
            {grace ? (
              <span className="text-[12px] text-muted-foreground">
                {daysLeftLabel(daysUntil(limits.graceEndsAt))}
              </span>
            ) : null}
          </div>
          {total > 0 ? (
            <div className="space-y-1.5">
              {/* The bar shows progress, so it waits for the first fix rather
                  than starting as an empty grey track. */}
              {fixedRows.length > 0 ? (
                <Progress
                  className="h-1.5"
                  value={fixedRows.length}
                  max={total}
                  aria-label={`${fixedRows.length} of ${total} fixed`}
                />
              ) : null}
              <p className="text-[12px] text-muted-foreground">
                {fixedRows.length} of {total} fixed
              </p>
            </div>
          ) : null}
          <p className="text-[13px] text-muted-foreground">
            {grace
              ? 'Until then everything keeps working. After that, what is over becomes read-only, hidden or paused. Nothing is deleted. It comes back when you upgrade.'
              : 'What is over is read-only, hidden or paused. Nothing is deleted. It comes back when you upgrade.'}
          </p>
          {/* On a phone the plan aside sits at the bottom, so the way out is here too. */}
          {canChoose && target && isPaidPlanId(target) ? (
            <Button size="sm" variant="outline" className="lg:hidden" asChild>
              <a href={checkoutPath({ plan: target })}>Upgrade to {targetName}</a>
            </Button>
          ) : null}
        </section>

        {total > 0 || infoRows.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Over your limits</h2>
            <PlanLimitIssues rows={[...issueRows, ...fixedRows, ...infoRows]} />
          </section>
        ) : null}

        {limits.featureIssues.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-base font-semibold">
              {grace ? `Pauses after ${shortDate}` : 'Paused'}
            </h2>
            {/* Whole-row links, as in the settings lists. */}
            <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border bg-card">
              {limits.featureIssues.map((feature) => {
                const text = (
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{feature.label}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {featureConsequence(feature.key, feature.count, tense, plan)}
                    </span>
                  </span>
                )
                return (
                  <li key={feature.key} data-plan-limit-feature={feature.key}>
                    {feature.href ? (
                      <a
                        href={feature.href}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-muted-foreground sm:px-5"
                      >
                        {text}
                        <ChevronRightIcon
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground/70"
                        />
                      </a>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{text}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Not affected</h2>
          <ul data-plan-limits-keeps="" className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {KEEPS_WORKING.map((item) => (
              <li key={item} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <CheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <KeepEverything
        target={target}
        lines={target ? keepEverythingLines(limits, target) : []}
        fromPlan={limits.fromPlan}
        canManageBilling={limits.canManageBilling}
        catalogue={props.catalogue}
      />

      {chooser ? (
        <PlanLimitsChooserDialog
          kind={chooser}
          limits={limits}
          date={shortDate}
          open
          onOpenChange={(open) => {
            if (!open) setChooser(null)
          }}
        />
      ) : null}
    </div>
  )
}

function planName(id: string, catalogue: BillingCatalogue | null): string {
  const entry = catalogue?.plans.find((plan) => plan.id === id)
  return entry?.name ?? id.charAt(0).toUpperCase() + id.slice(1)
}

function daysLeftLabel(days: number | null): string {
  if (days === null) return ''
  if (days === 0) return 'Last day'
  return `${days} ${days === 1 ? 'day' : 'days'} left`
}

function KeepEverything(props: {
  target: string | null
  /** What the plan keeps of this page, from its rows. */
  lines: string[]
  fromPlan: string | null
  canManageBilling: boolean
  catalogue: BillingCatalogue | null
}) {
  if (!props.target) return null
  const name = planName(props.target, props.catalogue)
  return (
    <aside
      data-settings-card=""
      data-plan-limits-keep={props.target}
      className="h-fit space-y-3 self-start rounded-xl border bg-card px-5 py-4 lg:sticky lg:top-4"
    >
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">Keep everything</p>
        <h2 className="mt-1 text-base font-semibold">{name}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {props.fromPlan === props.target
            ? 'The plan you had. Everything above stays as it is.'
            : 'Everything above stays as it is.'}
        </p>
      </div>
      {props.lines.length > 0 ? (
        <ul data-plan-limits-keep-lines="" className="space-y-1.5">
          {props.lines.map((line) => (
            <li key={line} className="flex gap-2 text-[13px]">
              <CheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {props.canManageBilling ? (
        <div className="space-y-2">
          {isPaidPlanId(props.target) ? (
            <Button size="sm" className="w-full" asChild>
              <a href={checkoutPath({ plan: props.target })}>Upgrade to {name}</a>
            </Button>
          ) : null}
          <a
            href="/admin/settings/billing"
            className={`${INLINE_LINK} block text-center text-[13px]`}
          >
            Compare plans
          </a>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Ask someone who manages billing to upgrade.
        </p>
      )}
    </aside>
  )
}
