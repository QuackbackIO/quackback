import { createServerFn } from '@tanstack/react-start'

/**
 * Server functions for settings utilities (logo/branding data).
 * These wrap the database-accessing utilities to keep DB code server-only.
 *
 * NOTE: All server-only imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 */

/**
 * Fetch logo data for settings
 */
export const fetchSettingsLogoData = createServerFn({ method: 'GET' }).handler(async () => {
  const { getSettingsLogoData } = await import('@/lib/settings-utils')
  return getSettingsLogoData()
})

/**
 * Fetch header logo data for settings
 */
export const fetchSettingsHeaderLogoData = createServerFn({ method: 'GET' }).handler(async () => {
  const { getSettingsHeaderLogoData } = await import('@/lib/settings-utils')
  return getSettingsHeaderLogoData()
})

/**
 * Fetch branding data for settings (logo, favicon, header logo, etc.)
 */
export const fetchSettingsBrandingData = createServerFn({ method: 'GET' }).handler(async () => {
  const { getSettingsBrandingData } = await import('@/lib/settings-utils')
  return getSettingsBrandingData()
})

/**
 * Fetch favicon data for settings
 */
export const fetchSettingsFaviconData = createServerFn({ method: 'GET' }).handler(async () => {
  const { getSettingsFaviconData } = await import('@/lib/settings-utils')
  return getSettingsFaviconData()
})

// Backwards-compatible exports
export const fetchWorkspaceLogoData = fetchSettingsLogoData
export const fetchWorkspaceFaviconData = fetchSettingsFaviconData
export const fetchWorkspaceHeaderLogoData = fetchSettingsHeaderLogoData
export const fetchWorkspaceBrandingData = fetchSettingsBrandingData
