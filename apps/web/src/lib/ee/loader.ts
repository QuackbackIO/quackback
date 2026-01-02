/**
 * EE Module Loader
 *
 * Provides utilities for conditionally loading Enterprise Edition packages.
 * EE packages are only loaded when:
 * 1. A valid enterprise license exists
 * 2. The EE packages are installed (not stripped from distribution)
 */

import { hasEnterpriseLicense } from '@/lib/license/license.server'

/**
 * Result of attempting to load an EE module
 */
export type EEModuleResult<T> =
  | { available: true; module: T }
  | { available: false; reason: 'no_license' | 'not_installed' }

/**
 * Load an EE module if licensed and available
 *
 * @param packageName - The EE package name (without @quackback/ee- prefix)
 * @returns The module if available, or null with reason
 *
 * @example
 * ```ts
 * const result = await loadEEModule<typeof import('@quackback/ee-sso')>('sso')
 * if (result.available) {
 *   const { configureSAML } = result.module
 *   // Use SSO functionality
 * }
 * ```
 */
export async function loadEEModule<T>(packageName: string): Promise<EEModuleResult<T>> {
  // Check license first
  if (!(await hasEnterpriseLicense())) {
    return { available: false, reason: 'no_license' }
  }

  // Try to dynamically import the EE package
  try {
    const module = (await import(`@quackback/ee-${packageName}`)) as T
    return { available: true, module }
  } catch {
    // Package not installed (open source distribution)
    return { available: false, reason: 'not_installed' }
  }
}

/**
 * Check if an EE module is available (licensed and installed)
 *
 * @param packageName - The EE package name (without @quackback/ee- prefix)
 * @returns true if the module can be loaded
 *
 * @example
 * ```ts
 * if (await isEEModuleAvailable('sso')) {
 *   // Show SSO configuration UI
 * }
 * ```
 */
export async function isEEModuleAvailable(packageName: string): Promise<boolean> {
  const result = await loadEEModule(packageName)
  return result.available
}

// Re-export stub types for use when modules aren't available
export type { SAMLConfig, SSOProvider, SSOConnection } from './stubs/sso'
export type { SCIMConfig, SCIMUser, SCIMGroup } from './stubs/scim'
export type { AuditEventType, AuditLogEntry, AuditLog, AuditLogger } from './stubs/audit'

/**
 * Load SSO module
 */
export async function loadSSOModule() {
  return loadEEModule<typeof import('./stubs/sso')>('sso')
}

/**
 * Load SCIM module
 */
export async function loadSCIMModule() {
  return loadEEModule<typeof import('./stubs/scim')>('scim')
}

/**
 * Load Audit module
 */
export async function loadAuditModule() {
  return loadEEModule<typeof import('./stubs/audit')>('audit')
}

/**
 * Get all available EE modules
 */
export async function getAvailableEEModules(): Promise<{
  sso: boolean
  scim: boolean
  audit: boolean
}> {
  const [sso, scim, audit] = await Promise.all([
    isEEModuleAvailable('sso'),
    isEEModuleAvailable('scim'),
    isEEModuleAvailable('audit'),
  ])

  return { sso, scim, audit }
}
