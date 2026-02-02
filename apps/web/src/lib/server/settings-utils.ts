/**
 * Settings utilities for fetching branding/logo data.
 * Simplified for single workspace OSS deployment.
 *
 * All images are stored in S3.
 */

import { getPublicUrlOrNull } from '@/lib/server/storage/s3'

export interface LogoData {
  url: string | null
}

export interface BrandingData {
  name: string
  logoUrl: string | null
  faviconUrl: string | null
  headerLogoUrl: string | null
  headerDisplayMode: string | null
  headerDisplayName: string | null
}

/**
 * Get the first (and only) settings record for single workspace deployment.
 */
async function getSettingsRecord() {
  const { db } = await import('@/lib/server/db')
  return db.query.settings.findFirst()
}

/**
 * Get logo data for the settings.
 */
export async function getSettingsLogoData(): Promise<LogoData | null> {
  const record = await getSettingsRecord()
  if (!record) return null

  const url = getPublicUrlOrNull(record.logoKey)
  if (!url) return null

  return { url }
}

/**
 * Get favicon data for the settings.
 */
export async function getSettingsFaviconData(): Promise<{ url: string } | null> {
  const record = await getSettingsRecord()
  if (!record) return null

  const url = getPublicUrlOrNull(record.faviconKey)
  if (!url) return null

  return { url }
}

export interface HeaderLogoData {
  url: string | null
  displayMode: string | null
  displayName: string | null
}

/**
 * Get header logo data for the settings.
 */
export async function getSettingsHeaderLogoData(): Promise<HeaderLogoData | null> {
  const record = await getSettingsRecord()
  if (!record) return null
  return {
    url: getPublicUrlOrNull(record.headerLogoKey),
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
    logoUrl: getPublicUrlOrNull(record.logoKey),
    faviconUrl: getPublicUrlOrNull(record.faviconKey),
    headerLogoUrl: getPublicUrlOrNull(record.headerLogoKey),
    headerDisplayMode: record.headerDisplayMode,
    headerDisplayName: record.headerDisplayName,
  }
}

// Backwards-compatible exports
export const getWorkspaceLogoData = getSettingsLogoData
export const getWorkspaceFaviconData = getSettingsFaviconData
export const getWorkspaceHeaderLogoData = getSettingsHeaderLogoData
export const getWorkspaceBrandingData = getSettingsBrandingData
