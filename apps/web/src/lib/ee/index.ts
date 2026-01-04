/**
 * Enterprise Edition utilities
 *
 * This module provides utilities for working with EE features.
 * For server-side EE module loading, use './loader'.
 */

export {
  loadEEModule,
  isEEModuleAvailable,
  loadSSOModule,
  loadSCIMModule,
  loadAuditModule,
  getAvailableEEModules,
  type EEModuleResult,
} from './loader'
