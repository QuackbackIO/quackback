import { useQuery } from '@tanstack/react-query'
import { useFeatureFlags, usePrincipalId } from '@/lib/client/hooks/use-root-context'
import { useHasPermission } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { AiCreditsState } from '@/lib/shared/billing/ai-credits'

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
 * True when Home is the Copilot chat for the current teammate. The Home
 * loader warms the answer; the tour reads it to offer the Copilot stop.
 */
export function useCopilotOnHome(): boolean {
  return useCopilotHome().onHome
}

/**
 * Home's Copilot: whether it is there for this teammate, and whether this
 * month's AI credits let it answer. Without credits it stays on Home, greyed
 * out, with the way to get more.
 */
export function useCopilotHome(): { onHome: boolean; credits: AiCreditsState } {
  const flags = useFeatureFlags()
  const principalId = usePrincipalId()
  const canUse = useHasPermission(PERMISSIONS.COPILOT_USE)
  const enabled = flags?.copilotHome === true && canUse
  const availability = useQuery({ ...copilotAvailabilityQuery(principalId), enabled })
  return {
    onHome: enabled && availability.data?.enabled === true,
    credits: availability.data?.credits ?? 'available',
  }
}
