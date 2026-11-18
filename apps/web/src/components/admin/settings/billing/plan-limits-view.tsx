import { useState, type ReactNode } from 'react'
import { CheckIcon } from '@heroicons/react/24/solid'
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
} from '@/lib/shared/billing/plan-limits-copy'
import { daysUntil } from '@/lib/shared/billing/trial-state'
import type { PlanCapKey } from '@/lib/shared/billing/plan-downgrade'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useLocalDateFormatter } from '@/components/ui/local-date'
import { DEADLINE_FORMAT } from '@/components/admin/plan-limits/plan-limits-banner'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { PlanLimitIssues, type PlanLimitRow } from './plan-limit-issues'
import {
  PlanLimitsChooserDialog,
  chooserAvailable,
  type PlanLimitsChooserKind,
} from './plan-limits-choosers'

/** The chooser for each cap that has one, with its button label. */
const CHOOSER_FOR: Partial<Record<PlanCapKey, { kind: PlanLimitsChooserKind; label: string }>> = {
  maxBoards: { kind: 'board', label: 'Choose the board to keep' },
  maxTeamSeats: { kind: 'seats', label: 'Choose who keeps a seat' },
  maxStatusComponents: { kind: 'statusComponents', label: 'Choose what shows' },
  maxSendingDomains: { kind: 'sendingDomains', label: 'Choose the domain to keep' },
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
          ? `This workspace fits the ${limits.planName} plan.`
          : 'This workspace fits its plan.'}
      </p>
    )
  }

  const grace = limits.phase === 'grace'
  const tense = limits.phase
  const date = format(limits.graceEndsAt, DEADLINE_FORMAT)
  const shortDate = format(limits.graceEndsAt, { day: 'numeric', month: 'short' })

  const can = (anyOf: readonly PermissionKey[]) => anyOf.some((p) => props.permissions.has(p))
  const issueRows: PlanLimitRow[] = limits.issues.map((issue) => {
    const choose = CHOOSER_FOR[issue.key]
    const manage = MANAGE[issue.key]
    const actions: ReactNode[] = []
    if (choose && chooserAvailable(choose.kind, limits)) {
      actions.push(
        <Button key="choose" size="sm" type="button" onClick={() => setChooser(choose.kind)}>
          {choose.label}
        </Button>
      )
    }
    if (manage && can(manage.anyOf)) {
      actions.push(
        <Button key="manage" size="sm" variant="outline" asChild>
          <a href={issue.href}>{manage.label}</a>
        </Button>
      )
    }
    return {
      key: issue.key,
      used: issue.used,
      cap: issue.cap,
      status: 'over',
      note: capConsequence(issue.key, issue.used - issue.cap, tense, shortDate),
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
              <Progress
                className="h-1.5"
                value={fixedRows.length}
                max={total}
                aria-label={`${fixedRows.length} of ${total} fixed`}
              />
              <p className="text-[12px] text-muted-foreground">
                {fixedRows.length} of {total} fixed
              </p>
            </div>
          ) : null}
          <p className="text-[13px] text-muted-foreground">
            {grace
              ? 'Until then everything keeps working. After that, extras are frozen and paid features pause. Nothing is deleted, and upgrading brings it all back at once.'
              : 'Extras are frozen and paid features are paused. Nothing is deleted, and upgrading brings it all back at once.'}
          </p>
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
              {grace ? `Pauses on ${shortDate}` : 'Paused'}
            </h2>
            <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border bg-card">
              {limits.featureIssues.map((feature) => (
                <li
                  key={feature.key}
                  data-plan-limit-feature={feature.key}
                  className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <p className="min-w-0 text-[13px]">
                    <span className="font-medium">{feature.label}.</span>{' '}
                    <span className="text-muted-foreground">
                      {featureConsequence(feature.key, feature.count, tense)}
                    </span>
                  </p>
                  {feature.href ? (
                    <a href={feature.href} className={`${INLINE_LINK} shrink-0 text-[13px]`}>
                      View
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Keeps working</h2>
          <ul className="flex flex-wrap gap-2">
            {KEEPS_WORKING.map((item) => (
              <li
                key={item}
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-[12px]"
              >
                <CheckIcon aria-hidden className="size-3 text-success" />
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
  const entry = props.catalogue?.plans.find((plan) => plan.id === props.target)
  const name = entry?.name ?? props.target.charAt(0).toUpperCase() + props.target.slice(1)
  return (
    <aside
      data-settings-card=""
      data-plan-limits-keep={props.target}
      className="h-fit space-y-3 rounded-xl border bg-card px-5 py-4"
    >
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">Keep everything</p>
        <h2 className="mt-1 text-base font-semibold">{name}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {props.fromPlan === props.target
            ? 'The plan you had. Nothing above changes.'
            : 'Nothing above changes.'}
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
              <a href={checkoutPath({ plan: props.target })}>Choose {name}</a>
            </Button>
          ) : null}
          <a
            href="/admin/settings/billing"
            className={`${INLINE_LINK} block text-center text-[13px]`}
          >
            Compare all plans
          </a>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Ask an owner to choose a plan.</p>
      )}
    </aside>
  )
}
