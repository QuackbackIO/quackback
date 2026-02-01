/**
 * Core Infrastructure Layer
 *
 * This directory contains infrastructure code that is foundational to the app:
 * - Database connection and schema exports
 * - Types for client components
 *
 * For most uses, import from the convenience re-exports:
 * - '@/lib/db' - Database access
 * - '@/lib/db-types' - Types for client components
 *
 * Related infrastructure (not yet moved to core/):
 * - '@/lib/auth' - Better Auth configuration
 * - '@/lib/tenant' - Multi-tenant context
 */

export * from './db'
export * from './db-types'
