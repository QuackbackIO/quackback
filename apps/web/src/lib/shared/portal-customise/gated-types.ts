import { isProductEnabled } from '@/lib/shared/types/settings'
import { isStatusPagePublished } from '@/lib/shared/status-settings'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import type { PortalBuiltInNavType } from '@/lib/shared/portal-header-nav'

/**
 * Built-in tab types a visitor cannot reach right now (product or tab off),
 * which the summary does not count. Sorted, so it can key the summary query.
 */
export function portalGatedTypes(
  settings:
    { featureFlags?: unknown; statusConfig?: unknown; portalConfig?: unknown } | null | undefined,
  session: { user?: { principalType?: string } | null } | null | undefined
): string[] {
  const flags = settings?.featureFlags as Parameters<typeof isProductEnabled>[0]
  const statusConfig = settings?.statusConfig as Parameters<typeof isStatusPagePublished>[1]
  const statusAudience = (statusConfig as { audience?: string } | undefined)?.audience ?? 'public'
  const statusLoggedIn = !!session?.user && session.user.principalType !== 'anonymous'
  const gates: Record<PortalBuiltInNavType, boolean> = {
    feedback: isProductEnabled(flags, 'feedback'),
    roadmap: isProductEnabled(flags, 'feedback'),
    changelog: isProductEnabled(flags, 'changelog'),
    help: isProductEnabled(flags, 'helpCenter'),
    support: isPortalSupportSurfaceEnabled(
      flags,
      settings?.portalConfig as Parameters<typeof isPortalSupportSurfaceEnabled>[1]
    ),
    status:
      isStatusPagePublished(flags, statusConfig) && (statusAudience === 'public' || statusLoggedIn),
  }
  return (Object.keys(gates) as PortalBuiltInNavType[]).filter((type) => !gates[type]).sort()
}
