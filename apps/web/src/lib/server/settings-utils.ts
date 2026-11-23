/**
 * Settings utilities for fetching branding/logo data.
 * Simplified for single workspace OSS deployment.
 *
 * All images are stored in S3.
 */

import { absolutizeOffHostAssetUrl } from '@/lib/server/storage/asset-url'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'

function offHostPublicUrl(key: string | null | undefined): string | null {
  const stored = getPublicUrlOrNull(key)
  return stored ? absolutizeOffHostAssetUrl(stored) : stored
}

export interface LogoData {
  url: string | null
  /** The workspace icon's stored key and its favicon's, for Customise. */
  key?: string | null
  faviconKey?: string | null
}

export interface BrandingData {
  name: string
  logoUrl: string | null
  faviconUrl: string | null
  headerLogoUrl: string | null
  /** The header logo's dark mode version, when the workspace has one. */
  headerLogoDarkUrl: string | null
  headerDisplayMode: string | null
  headerDisplayName: string | null
}

/**
 * The workspace's settings row, from the settings the request already holds:
 * every reader here is read-only.
 */
async function getSettingsRecord() {
  const { findSettingsCached } = await import('@/lib/server/domains/settings/settings.helpers')
  return findSettingsCached()
}

/** The header logo's dark mode version, as the portal's settings hold it. */
async function headerLogoDarkKeyOf(portalConfig: string | null): Promise<string | null> {
  const { parsePortalConfig } = await import('@/lib/server/domains/settings/settings.helpers')
  return parsePortalConfig(portalConfig).headerLogoDarkKey ?? null
}

/**
 * Get logo data for the settings.
 */
export async function getSettingsLogoData(): Promise<LogoData | null> {
  const record = await getSettingsRecord()
  if (!record) return null

  const url = offHostPublicUrl(record.logoKey)
  if (!url) return null

  // The keys let Customise name the icon a publish replaces.
  return { url, key: record.logoKey, faviconKey: record.faviconKey ?? null }
}

export interface HeaderLogoData {
  /** The stored object, which a Customise publish names as the logo it replaces. */
  key: string | null
  url: string | null
  /** The dark mode version's stored object, or null when there is none. */
  darkKey: string | null
  displayMode: string | null
  displayName: string | null
}

/**
 * Get favicon data for the settings.
 */
export async function getSettingsFaviconData(): Promise<LogoData | null> {
  const record = await getSettingsRecord()
  if (!record) return null

  const url = getPublicUrlOrNull(record.faviconKey)
  if (!url) return null

  return { url }
}

/**
 * Get header logo data for the settings.
 */
export async function getSettingsHeaderLogoData(): Promise<HeaderLogoData | null> {
  const record = await getSettingsRecord()
  if (!record) return null
  return {
    key: record.headerLogoKey,
    url: getPublicUrlOrNull(record.headerLogoKey),
    darkKey: await headerLogoDarkKeyOf(record.portalConfig),
    displayMode: record.headerDisplayMode,
    displayName: record.headerDisplayName,
  }
}

/**
 * Get branding data for the settings.
 */
export async function getSettingsBrandingData(): Promise<BrandingData | null> {
  const record = await getSettingsRecord()
  if (!record) return null
  return {
    name: record.name,
    logoUrl: offHostPublicUrl(record.logoKey),
    faviconUrl: getPublicUrlOrNull(record.faviconKey),
    headerLogoUrl: getPublicUrlOrNull(record.headerLogoKey),
    headerLogoDarkUrl: getPublicUrlOrNull(await headerLogoDarkKeyOf(record.portalConfig)),
    headerDisplayMode: record.headerDisplayMode,
    headerDisplayName: record.headerDisplayName,
  }
}
