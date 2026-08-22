/**
 * Settings query hooks
 *
 * Query hooks for settings data.
 * Mutations are in @/lib/client/mutations/settings.
 */

import { useQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'

// ============================================================================
// Query Hooks
// ============================================================================

export function useSettingsLogo() {
  return useQuery({
    ...settingsQueries.logo(),
    enabled: false, // Use SSR data, don't auto-fetch
  })
}

export function useSettingsHeaderLogo() {
  return useQuery({
    ...settingsQueries.headerLogo(),
    enabled: false, // Use SSR data, don't auto-fetch
  })
}
