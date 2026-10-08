import { useQuery } from '@tanstack/react-query'
import { useFeatureFlags, usePrincipalId } from '@/lib/client/hooks/use-root-context'
import { useHasPermission } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { WorkspaceCopilotAvailability } from '@/lib/shared/assistant/workspace-contract'

/** Whether this teammate gets the Copilot chat on Home (flag, model and permission). */
export function copilotAvailabilityQuery(principalId: string | null | undefined) {
  return {
    queryKey: ['admin', 'workspace-copilot', 'availability', principalId ?? null] as const,
    // Loaded on use: the hook sits in the admin layout (the tour), and the
    // Home loader has usually warmed the answer already.
    queryFn: async () =>
      (
        await import('@/lib/server/functions/workspace-copilot')
      ).getWorkspaceCopilotAvailabilityFn(),
    staleTime: 30_000,
  }
}

/**
 * How Copilot sits on Home: live while the workspace has AI allowance left,
 * paused until the allowance resets once this period's is used, or not there
 * at all (no AI set up, or a plan with no AI allowance), when Home is the
 * overview.
 */
export type HomeCopilotState =
  { kind: 'live' } | { kind: 'paused'; resetsAt: string | null } | { kind: 'off' }

/** Home's Copilot from the server's answer and whether the flag and permission allow it. */
export function homeCopilotState(
  availability: WorkspaceCopilotAvailability | null | undefined,
  allowed: boolean
): HomeCopilotState {
  if (!allowed || availability?.enabled !== true) return { kind: 'off' }
  if (availability.credits === 'none') return { kind: 'off' }
  if (availability.credits === 'used') {
    return { kind: 'paused', resetsAt: availability.resetsAt ?? null }
  }
  return { kind: 'live' }
}

/**
 * True when Home is the Copilot chat for the current teammate. The Home
 * loader warms the answer; the tour reads it to offer the Copilot stop.
 */
export function useCopilotOnHome(): boolean {
  return useCopilotHome().onHome
}

/** Home's Copilot for the current teammate: whether it is there, and its state. */
export function useCopilotHome(): { onHome: boolean; state: HomeCopilotState } {
  const flags = useFeatureFlags()
  const principalId = usePrincipalId()
  const canUse = useHasPermission(PERMISSIONS.COPILOT_USE)
  const allowed = flags?.copilotHome === true && canUse
  const availability = useQuery({ ...copilotAvailabilityQuery(principalId), enabled: allowed })
  const state = homeCopilotState(availability.data, allowed)
  return { onHome: state.kind !== 'off', state }
}
