import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

/** Cheapest catalogue plan that grants SSO. Keep in lockstep with PLAN_CATALOGUE. */
export function ssoUpgradePlanName(): string {
  return 'Scale'
}

export function SsoUpgradeNotice() {
  const plan = ssoUpgradePlanName()
  return (
    <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Single sign-on is a {plan} feature. Upgrade to {plan} to add an identity provider.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-3">
        <a href="/admin/settings/billing">
          Upgrade to {plan}
          <ArrowTopRightOnSquareIcon className="ml-1.5 h-3.5 w-3.5" />
        </a>
      </Button>
    </div>
  )
}
