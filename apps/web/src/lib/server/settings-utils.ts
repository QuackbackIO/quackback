/**
 * Settings utilities for fetching branding/logo data.
 * Simplified for single workspace OSS deployment.
 *
 * Logos are stored as bytea blobs in the database and converted to data URLs on read.
 */

/**
 * Convert a bytea blob and MIME type to a data URL.
 */
function blobToDataUrl(blob: Buffer | null, mimeType: string | null): string | null {
  if (!blob || !mimeType) return null
  const base64 = Buffer.from(blob).toString('base64')
  return `data:${mimeType};base64,${base64}`
}

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
  if (!record?.logoBlob) return null
  return {
    url: blobToDataUrl(record.logoBlob, record.logoType),
  }
}

/**
 * Get favicon data for the settings.
 */
export async function getSettingsFaviconData(): Promise<{ url: string } | null> {
  const record = await getSettingsRecord()
  const url = blobToDataUrl(record?.faviconBlob ?? null, record?.faviconType ?? null)
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
    url: blobToDataUrl(record.headerLogoBlob, record.headerLogoType),
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
    logoUrl: blobToDataUrl(record.logoBlob, record.logoType),
    faviconUrl: blobToDataUrl(record.faviconBlob, record.faviconType),
    headerLogoUrl: blobToDataUrl(record.headerLogoBlob, record.headerLogoType),
    headerDisplayMode: record.headerDisplayMode,
    headerDisplayName: record.headerDisplayName,
  }
}

// Backwards-compatible exports
export const getWorkspaceLogoData = getSettingsLogoData
export const getWorkspaceFaviconData = getSettingsFaviconData
export const getWorkspaceHeaderLogoData = getSettingsHeaderLogoData
export const getWorkspaceBrandingData = getSettingsBrandingData
