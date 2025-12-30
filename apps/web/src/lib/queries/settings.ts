import { queryOptions } from '@tanstack/react-query'
import type { UserId } from '@quackback/ids'
import {
  getBrandingConfig,
  getCustomCss,
  getPortalConfig,
  getPublicPortalConfig,
  getPublicAuthConfig,
  DEFAULT_PORTAL_CONFIG,
} from '@/lib/settings'
import { getSettingsLogoData, getSettingsHeaderLogoData } from '@/lib/settings-utils'
import { fetchTeamMembersAndInvitations, fetchUserProfile } from '@/lib/server-functions/settings'

/**
 * Query options factory for settings routes.
 * Uses service functions that return Result<T, E> types.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const settingsQueries = {
  /**
   * Get branding configuration
   */
  branding: () =>
    queryOptions({
      queryKey: ['settings', 'branding'],
      queryFn: async () => {
        const result = await getBrandingConfig()
        if (!result.success) throw new Error(result.error.message)
        return result.value
      },
      staleTime: 5 * 60 * 1000, // 5min - branding doesn't change often
    }),

  /**
   * Get workspace logo data for settings
   */
  logo: () =>
    queryOptions({
      queryKey: ['settings', 'logo'],
      queryFn: async () => {
        const logoData = await getSettingsLogoData()
        return logoData
      },
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get workspace header logo data for settings
   */
  headerLogo: () =>
    queryOptions({
      queryKey: ['settings', 'headerLogo'],
      queryFn: async () => {
        const headerData = await getSettingsHeaderLogoData()
        return headerData
      },
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get custom CSS
   */
  customCss: () =>
    queryOptions({
      queryKey: ['settings', 'customCss'],
      queryFn: async () => {
        const result = await getCustomCss()
        if (!result.success) throw new Error(result.error.message)
        return result.value ?? ''
      },
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get portal configuration (admin)
   */
  portalConfig: () =>
    queryOptions({
      queryKey: ['settings', 'portalConfig'],
      queryFn: async () => {
        const result = await getPortalConfig()
        if (!result.success) throw new Error(result.error.message)
        return result.value ?? DEFAULT_PORTAL_CONFIG
      },
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get public portal configuration (for login pages)
   */
  publicPortalConfig: () =>
    queryOptions({
      queryKey: ['settings', 'publicPortalConfig'],
      queryFn: async () => {
        const result = await getPublicPortalConfig()
        if (!result.success) throw new Error(result.error.message)
        return result.value
      },
      staleTime: 5 * 60 * 1000,
    }),

  /**
   * Get public auth configuration (for admin login)
   */
  publicAuthConfig: () =>
    queryOptions({
      queryKey: ['settings', 'publicAuthConfig'],
      queryFn: async () => {
        const result = await getPublicAuthConfig()
        if (!result.success) throw new Error(result.error.message)
        return result.value
      },
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
      queryFn: () => fetchUserProfile(userId),
      staleTime: 1 * 60 * 1000, // 1min
    }),
}
