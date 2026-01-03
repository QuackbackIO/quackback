/**
 * Tenant AsyncLocalStorage
 *
 * Provides request-scoped storage for tenant context.
 * Separated into its own module to avoid circular dependencies.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { TenantContext } from './types'

/**
 * AsyncLocalStorage for tenant context.
 * Allows any code in the request chain to access the current tenant.
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>()
