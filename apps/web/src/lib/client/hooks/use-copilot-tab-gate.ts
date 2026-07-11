import { useRouteContext } from '@tanstack/react-router'
import { usePermission } from './use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'

/**
 * Whether the inbox detail panel's Copilot tab exists for this viewer: the
 * `assistantCopilot` flag AND `copilot.use`. The one gate shared by
 * InboxDetailPanel (which renders the tab) and the inbox route (which layers
 * its ≥xl-viewport term on top for the Ask Copilot shortcut / command-bar
 * row), so the two sides can never disagree about the tab existing.
 */
export function useCopilotTabGate(): boolean {
  const { settings } = useRouteContext({ from: '/admin' }) as {
    settings?: { featureFlags?: FeatureFlags } | null
  }
  const hasCopilotPermission = usePermission(PERMISSIONS.COPILOT_USE)
  return !!settings?.featureFlags?.assistantCopilot && hasCopilotPermission
}
