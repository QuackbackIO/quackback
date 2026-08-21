import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { selectActivationAction, type ActivationSurface } from '@/lib/shared/activation-action'

/** The one contextual action the current surface is allowed to promote. */
export function useActivationAction(surface: ActivationSurface) {
  const query = useQuery(adminQueries.onboardingStatus())
  if (!query.data) return null
  return selectActivationAction({ surface, status: query.data })
}
