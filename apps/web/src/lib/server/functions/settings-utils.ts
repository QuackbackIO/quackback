import { createServerFn } from '@tanstack/react-start'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'settings-utils' })
import {
  getSettingsLogoData,
  getSettingsHeaderLogoData,
  getSettingsBrandingData,
  getSettingsFaviconData,
} from '@/lib/server/settings-utils'

/**
 * Server functions for settings utilities (logo/branding data).
 * These wrap the database-accessing utilities to keep DB code server-only.
 */

/**
 * Fetch logo data for settings
 */
export const fetchSettingsLogoData = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetching settings logo data')
  const data = await getSettingsLogoData()
  log.debug({ has_logo: !!data }, 'settings logo data fetched')
  return data
})

/**
 * Fetch header logo data for settings
 */
export const fetchSettingsHeaderLogoData = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetching settings header logo data')
  const data = await getSettingsHeaderLogoData()
  log.debug({ has_header_logo: !!data }, 'settings header logo data fetched')
  return data
})

/**
 * Fetch branding data for settings (logo, favicon, header logo, etc.)
 */
export const fetchSettingsBrandingData = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetching settings branding data')
  const data = await getSettingsBrandingData()
  log.debug('settings branding data fetched')
  return data
})

/**
 * Fetch favicon data for settings
 */
export const fetchSettingsFaviconData = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetching settings favicon data')
  const data = await getSettingsFaviconData()
  log.debug({ has_favicon: !!data }, 'settings favicon data fetched')
  return data
})
