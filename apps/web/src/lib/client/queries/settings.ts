import { queryOptions } from '@tanstack/react-query'
import type { UserId } from '@quackback/ids'
import {
  fetchBrandingConfig,
  fetchPortalConfig,
  fetchPublicPortalConfig,
  fetchPublicAuthConfig,
  fetchTeamMembersAndInvitations,
  fetchUserProfile,
  fetchCustomCssFn,
  fetchDeveloperConfig,
  fetchWidgetConfig,
  fetchWidgetSecret,
} from '@/lib/server/functions/settings'
import {
  fetchSettingsLogoData,
  fetchSettingsHeaderLogoData,
} from '@/lib/server/functions/settings-utils'

const STALE_TIME_SHORT = 30 * 1000
const STALE_TIME_MEDIUM = 60 * 1000
const STALE_TIME_LONG = 5 * 60 * 1000

export const settingsQueries = {
  branding: () =>
    queryOptions({
      queryKey: ['settings', 'branding'],
      queryFn: fetchBrandingConfig,
      staleTime: STALE_TIME_LONG,
    }),

  customCss: () =>
    queryOptions({
      queryKey: ['settings', 'customCss'],
      queryFn: fetchCustomCssFn,
      staleTime: STALE_TIME_LONG,
    }),

  logo: () =>
    queryOptions({
      queryKey: ['settings', 'logo'],
      queryFn: fetchSettingsLogoData,
      staleTime: STALE_TIME_LONG,
    }),

  headerLogo: () =>
    queryOptions({
      queryKey: ['settings', 'headerLogo'],
      queryFn: fetchSettingsHeaderLogoData,
      staleTime: STALE_TIME_LONG,
    }),

  portalConfig: () =>
    queryOptions({
      queryKey: ['settings', 'portalConfig'],
      queryFn: fetchPortalConfig,
      staleTime: STALE_TIME_LONG,
    }),

  publicPortalConfig: () =>
    queryOptions({
      queryKey: ['settings', 'publicPortalConfig'],
      queryFn: fetchPublicPortalConfig,
      staleTime: STALE_TIME_LONG,
    }),

  publicAuthConfig: () =>
    queryOptions({
      queryKey: ['settings', 'publicAuthConfig'],
      queryFn: fetchPublicAuthConfig,
      staleTime: STALE_TIME_LONG,
    }),

  developerConfig: () =>
    queryOptions({
      queryKey: ['settings', 'developerConfig'],
      queryFn: fetchDeveloperConfig,
      staleTime: STALE_TIME_LONG,
    }),

  teamMembersAndInvitations: () =>
    queryOptions({
      queryKey: ['settings', 'team'],
      queryFn: fetchTeamMembersAndInvitations,
      staleTime: STALE_TIME_SHORT,
    }),

  userProfile: (userId: UserId) =>
    queryOptions({
      queryKey: ['settings', 'userProfile', userId],
      queryFn: () => fetchUserProfile({ data: userId }),
      staleTime: STALE_TIME_MEDIUM,
    }),

  widgetConfig: () =>
    queryOptions({
      queryKey: ['settings', 'widgetConfig'],
      queryFn: fetchWidgetConfig,
      staleTime: STALE_TIME_LONG,
    }),

  widgetSecret: () =>
    queryOptions({
      queryKey: ['settings', 'widgetSecret'],
      queryFn: fetchWidgetSecret,
      staleTime: STALE_TIME_LONG,
    }),
}
