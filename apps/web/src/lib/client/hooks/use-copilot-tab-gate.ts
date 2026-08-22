import { usePermission } from './use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * Whether the inbox detail panel's Copilot tab exists for this viewer:
 * `copilot.use`. The one gate shared by InboxDetailPanel (which renders the
 * tab) and the inbox route (which layers its ≥xl-viewport term on top for
 * the Ask Copilot shortcut / command-bar row), so the two sides can never
 * disagree about the tab existing.
 */
export function useCopilotTabGate(): boolean {
  return usePermission(PERMISSIONS.COPILOT_USE)
}
