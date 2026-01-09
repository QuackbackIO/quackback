import { queryOptions } from '@tanstack/react-query'
import type { UserId } from '@quackback/ids'
import {
  fetchBrandingConfig,
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

export const settingsQueries = {
  branding: () =>
    queryOptions({
      queryKey: ['settings', 'branding'],
      queryFn: () => fetchBrandingConfig(),
      staleTime: 5 * 60 * 1000,
    }),

  logo: () =>
    queryOptions({
      queryKey: ['settings', 'logo'],
      queryFn: () => fetchSettingsLogoData(),
      staleTime: 5 * 60 * 1000,
    }),

  headerLogo: () =>
    queryOptions({
      queryKey: ['settings', 'headerLogo'],
      queryFn: () => fetchSettingsHeaderLogoData(),
      staleTime: 5 * 60 * 1000,
    }),

  portalConfig: () =>
    queryOptions({
      queryKey: ['settings', 'portalConfig'],
      queryFn: () => fetchPortalConfig(),
      staleTime: 5 * 60 * 1000,
    }),

  publicPortalConfig: () =>
    queryOptions({
      queryKey: ['settings', 'publicPortalConfig'],
      queryFn: () => fetchPublicPortalConfig(),
      staleTime: 5 * 60 * 1000,
    }),

  publicAuthConfig: () =>
    queryOptions({
      queryKey: ['settings', 'publicAuthConfig'],
      queryFn: () => fetchPublicAuthConfig(),
      staleTime: 5 * 60 * 1000,
    }),

  teamMembersAndInvitations: () =>
    queryOptions({
      queryKey: ['settings', 'team'],
      queryFn: () => fetchTeamMembersAndInvitations(),
      staleTime: 30 * 1000,
    }),

  userProfile: (userId: UserId) =>
    queryOptions({
      queryKey: ['settings', 'userProfile', userId],
      queryFn: () => fetchUserProfile({ data: userId }),
      staleTime: 1 * 60 * 1000,
    }),
}
