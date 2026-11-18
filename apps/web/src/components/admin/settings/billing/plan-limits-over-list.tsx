import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import { Button } from '@/components/ui/button'
import { PLAN_LIMITS_PATH } from '@/lib/shared/billing/plan-limits-path'
import { PlanLimitIssues } from './plan-limit-issues'

/**
 * The caps over the plan, above the ended-trial plan choice. Loaded only for
 * a workspace that is over, so the billing page never ships it otherwise.
 */
export default function PlanLimitsOverList(props: { limits: PlanLimitsPage }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Over your limits</h2>
        <Button size="sm" variant="outline" asChild>
          <a href={PLAN_LIMITS_PATH}>See plan limits</a>
        </Button>
      </div>
      <PlanLimitIssues
        rows={props.limits.issues.map((issue) => ({
          key: issue.key,
          used: issue.used,
          cap: issue.cap,
          status: 'over' as const,
        }))}
      />
    </section>
  )
}
