import { createServerFn } from '@tanstack/react-start'
import {
  getSettingsLogoData,
  getSettingsHeaderLogoData,
  getSettingsBrandingData,
  getSettingsFaviconData,
} from '@/lib/settings-utils'

/**
 * Server functions for settings utilities (logo/branding data).
 * These wrap the database-accessing utilities to keep DB code server-only.
 */

/**
 * Fetch logo data for settings
 */
export const fetchSettingsLogoData = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings-utils] fetchSettingsLogoData`)
  try {
    const data = await getSettingsLogoData()
    console.log(`[fn:settings-utils] fetchSettingsLogoData: hasLogo=${!!data}`)
    return data
  } catch (error) {
    console.error(`[fn:settings-utils] ❌ fetchSettingsLogoData failed:`, error)
    throw error
  }
})

/**
 * Fetch header logo data for settings
 */
export const fetchSettingsHeaderLogoData = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings-utils] fetchSettingsHeaderLogoData`)
  try {
    const data = await getSettingsHeaderLogoData()
    console.log(`[fn:settings-utils] fetchSettingsHeaderLogoData: hasHeaderLogo=${!!data}`)
    return data
  } catch (error) {
    console.error(`[fn:settings-utils] ❌ fetchSettingsHeaderLogoData failed:`, error)
    throw error
  }
})

/**
 * Fetch branding data for settings (logo, favicon, header logo, etc.)
 */
export const fetchSettingsBrandingData = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings-utils] fetchSettingsBrandingData`)
  try {
    const data = await getSettingsBrandingData()
    console.log(`[fn:settings-utils] fetchSettingsBrandingData: fetched`)
    return data
  } catch (error) {
    console.error(`[fn:settings-utils] ❌ fetchSettingsBrandingData failed:`, error)
    throw error
  }
})

/**
 * Fetch favicon data for settings
 */
export const fetchSettingsFaviconData = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:settings-utils] fetchSettingsFaviconData`)
  try {
    const data = await getSettingsFaviconData()
    console.log(`[fn:settings-utils] fetchSettingsFaviconData: hasFavicon=${!!data}`)
    return data
  } catch (error) {
    console.error(`[fn:settings-utils] ❌ fetchSettingsFaviconData failed:`, error)
    throw error
  }
})

// Backwards-compatible exports
export const fetchWorkspaceLogoData = fetchSettingsLogoData
export const fetchWorkspaceFaviconData = fetchSettingsFaviconData
export const fetchWorkspaceHeaderLogoData = fetchSettingsHeaderLogoData
export const fetchWorkspaceBrandingData = fetchSettingsBrandingData
