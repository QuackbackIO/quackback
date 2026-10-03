import { useQuery } from '@tanstack/react-query'
import { useFeatureFlags, usePrincipalId } from '@/lib/client/hooks/use-root-context'
import { useHasPermission } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { getWorkspaceCopilotAvailabilityFn } from '@/lib/server/functions/workspace-copilot'

/** Whether this teammate gets the Copilot chat on Home (flag, model and permission). */
export function copilotAvailabilityQuery(principalId: string | null | undefined) {
  return {
    queryKey: ['admin', 'workspace-copilot', 'availability', principalId ?? null] as const,
    queryFn: () => getWorkspaceCopilotAvailabilityFn(),
    staleTime: 30_000,
  }
}

/**
 * True when Home is the Copilot chat for the current teammate. The Home
 * loader warms the answer; the tour reads it to offer the Copilot stop.
 */
export function useCopilotOnHome(): boolean {
  const flags = useFeatureFlags()
  const principalId = usePrincipalId()
  const canUse = useHasPermission(PERMISSIONS.COPILOT_USE)
  const enabled = flags?.copilotHome === true && canUse
  const availability = useQuery({ ...copilotAvailabilityQuery(principalId), enabled })
  return enabled && availability.data?.enabled === true
}
