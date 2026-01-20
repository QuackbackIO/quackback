import { Link } from '@tanstack/react-router'
import { LockClosedIcon, ArrowRightIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

interface EnterpriseUpgradePromptProps {
  feature: string
  description: string
  benefits?: string[]
  isSelfHosted?: boolean
}

/**
 * A reusable component to show when an enterprise feature is not available.
 * Displays an upgrade prompt with feature benefits and action buttons.
 */
export function EnterpriseUpgradePrompt({
  feature,
  description,
  benefits = [],
  isSelfHosted = false,
}: EnterpriseUpgradePromptProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="max-w-md text-center space-y-6">
        {/* Icon */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <LockClosedIcon className="h-8 w-8 text-primary" />
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">{feature}</h2>
          <p className="text-muted-foreground">{description}</p>
        </div>

        {/* Benefits list */}
        {benefits.length > 0 && (
          <ul className="text-sm text-left space-y-2 bg-muted/50 rounded-lg p-4">
            {benefits.map((benefit, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span className="text-muted-foreground">{benefit}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Enterprise badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
          <LockClosedIcon className="h-4 w-4" />
          Enterprise Feature
        </div>

        {/* Action button */}
        <Button asChild>
          {/* Route path typed as string since license/billing routes are edition-specific */}
          <Link to={(isSelfHosted ? '/admin/settings/license' : '/admin/settings/billing') as '/'}>
            {isSelfHosted ? 'View License Settings' : 'Upgrade Plan'}
            <ArrowRightIcon className="ml-2 h-4 w-4" />
          </Link>
        </Button>

        {/* Help text */}
        <p className="text-xs text-muted-foreground">
          {isSelfHosted
            ? 'Set the ENTERPRISE_LICENSE_KEY environment variable to activate enterprise features.'
            : 'Upgrade to an Enterprise plan to unlock this feature and more.'}
        </p>
      </div>
    </div>
  )
}
