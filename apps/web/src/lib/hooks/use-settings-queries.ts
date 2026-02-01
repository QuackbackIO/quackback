/**
 * Settings query hooks
 *
 * Query hooks for workspace settings.
 * Mutations are in @/lib/mutations/settings.
 */

import { useQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'

// ============================================================================
// Query Hooks
// ============================================================================

export function useWorkspaceLogo() {
  return useQuery({
    ...settingsQueries.logo(),
    enabled: false, // Use SSR data, don't auto-fetch
  })
}

export function useWorkspaceHeaderLogo() {
  return useQuery({
    ...settingsQueries.headerLogo(),
    enabled: false, // Use SSR data, don't auto-fetch
  })
}
