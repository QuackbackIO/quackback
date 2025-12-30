'use client'

import { Feature, getMinimumTierForFeature, TIER_CONFIG } from '@/lib/features'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles, ArrowRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'

interface UpgradePromptProps {
  /** The feature that requires an upgrade */
  feature: Feature
  /** Custom title (defaults to "Upgrade Required") */
  title?: string
  /** Custom description (defaults to tier-based message) */
  description?: string
  /** Whether to show as a compact inline prompt */
  compact?: boolean
}

/**
 * Upgrade prompt component shown when a feature is not available.
 *
 * Usage:
 * ```tsx
 * <UpgradePrompt feature={Feature.CUSTOM_DOMAIN} />
 *
 * // With custom messaging
 * <UpgradePrompt
 *   feature={Feature.WEBHOOKS}
 *   title="Enable Webhooks"
 *   description="Send real-time updates to your other tools."
 * />
 *
 * // Compact inline version
 * <UpgradePrompt feature={Feature.API_ACCESS} compact />
 * ```
 */
export function UpgradePrompt({
  feature,
  title,
  description,
  compact = false,
}: UpgradePromptProps) {
  const requiredTier = getMinimumTierForFeature(feature)
  const tierConfig = requiredTier ? TIER_CONFIG[requiredTier] : null
  const tierName = tierConfig?.name ?? 'a higher'
  const price = tierConfig?.price

  const defaultDescription = price
    ? `This feature is available on the ${tierName} plan ($${price}/month) and above.`
    : `This feature requires the ${tierName} plan.`

  if (compact) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed border-border bg-muted/30 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">{title ?? 'Upgrade Required'}</p>
            <p className="text-xs text-muted-foreground">{description ?? defaultDescription}</p>
          </div>
        </div>
        <Button size="sm" asChild>
          <Link to="/admin/settings/billing">
            Upgrade
            <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          {title ?? 'Upgrade Required'}
        </CardTitle>
        <CardDescription>{description ?? defaultDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/admin/settings/billing">
            View Plans
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

// Re-export Feature for convenience
export { Feature }
