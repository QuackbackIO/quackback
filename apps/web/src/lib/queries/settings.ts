import { queryOptions } from '@tanstack/react-query'
import type { UserId } from '@quackback/ids'
import {
  fetchBrandingConfig,
  fetchCustomCss,
  fetchPortalConfig,
  fetchPublicPortalConfig,
  fetchPublicAuthConfig,
  fetchTeamMembersAndInvitations,
  fetchUserProfile,
} from '@/lib/server-functions/settings'
import {
  fetchSettingsLogoData,
  fetchSettingsHeaderLogoData,
} from '@/lib/server-functions/settings-utils'

/**
 * Query options factory for settings routes.
 * Uses server functions (createServerFn) to keep database code server-only.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const settingsQueries = {
  /**
   * Get branding configuration
   */
  branding: () =>
    queryOptions({
      queryKey: ['settings', 'branding'],
      queryFn: () => fetchBrandingConfig(),
      staleTime: 5 * 60 * 1000, // 5min - branding doesn't change often
    }),

  /**
   * Get workspace logo data for settings
   */
  logo: () =>
    queryOptions({
      queryKey: ['settings', 'logo'],
      queryFn: () => fetchSettingsLogoData(),
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get workspace header logo data for settings
   */
  headerLogo: () =>
    queryOptions({
      queryKey: ['settings', 'headerLogo'],
      queryFn: () => fetchSettingsHeaderLogoData(),
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get custom CSS
   */
  customCss: () =>
    queryOptions({
      queryKey: ['settings', 'customCss'],
      queryFn: async () => {
        const css = await fetchCustomCss()
        return css ?? ''
      },
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get portal configuration (admin)
   */
  portalConfig: () =>
    queryOptions({
      queryKey: ['settings', 'portalConfig'],
      queryFn: () => fetchPortalConfig(),
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get public portal configuration (for login pages)
   */
  publicPortalConfig: () =>
    queryOptions({
      queryKey: ['settings', 'publicPortalConfig'],
      queryFn: () => fetchPublicPortalConfig(),
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get public auth configuration (for admin login)
   */
  publicAuthConfig: () =>
    queryOptions({
      queryKey: ['settings', 'publicAuthConfig'],
      queryFn: () => fetchPublicAuthConfig(),
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get team members and invitations
   */
  teamMembersAndInvitations: () =>
    queryOptions({
      queryKey: ['settings', 'team'],
      queryFn: () => fetchTeamMembersAndInvitations(),
      staleTime: 30 * 1000, // 30s - team changes should update quickly
    }),

  /**
   * Get user profile including avatar
   */
  userProfile: (userId: UserId) =>
    queryOptions({
      queryKey: ['settings', 'userProfile', userId],
      queryFn: () => fetchUserProfile({ data: userId }),
      staleTime: 1 * 60 * 1000, // 1min
    }),
}
