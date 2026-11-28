import { Button } from '@/components/ui/button'
import { planRefusalCopy } from './plan-refusal-copy'
import { ErrorPageCopy, FriendlyShell } from './error-page'

/**
 * A plan refusal that reached a route's error boundary: what the plan does
 * not include, and the way to the plan that does.
 */
export default function EntitlementRequiredPage({
  error,
  fullPage = true,
}: {
  error: unknown
  fullPage?: boolean
}) {
  const isAdminArea = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')

  return (
    <FriendlyShell fullPage={fullPage}>
      <ErrorPageCopy>
        {(copy) => {
          const refusal = planRefusalCopy(error, copy)
          return (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">{refusal.headline}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{refusal.body}</p>
              <div className="mt-6 flex items-center justify-center gap-3">
                {isAdminArea ? (
                  <Button asChild>
                    <a href="/admin/settings/billing">
                      {refusal.requiredPlanName
                        ? copy(
                            {
                              id: 'common.errorPage.plan.upgradeTo',
                              defaultMessage: 'Upgrade to {plan}',
                            },
                            { plan: refusal.requiredPlanName }
                          )
                        : copy({
                            id: 'common.errorPage.plan.seePlans',
                            defaultMessage: 'See plans',
                          })}
                    </a>
                  </Button>
                ) : null}
                <Button variant="outline" asChild>
                  <a href={isAdminArea ? '/admin/settings' : '/'}>
                    {copy({ id: 'common.errorPage.plan.goBack', defaultMessage: 'Go back' })}
                  </a>
                </Button>
              </div>
            </>
          )
        }}
      </ErrorPageCopy>
    </FriendlyShell>
  )
}
