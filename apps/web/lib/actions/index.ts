/**
 * Server Actions Module
 *
 * This module exports all server actions for use in client components.
 * Server actions replace API routes for frontend mutations.
 *
 * @example
 * import { createTagAction } from '@/lib/actions'
 * // or
 * import { createTagAction } from '@/lib/actions/tags'
 */

// Core types and utilities (client-safe)
export * from './types'

// Note: withAction and withAuthAction are server-only utilities
// Import directly from './with-action' in server action files

// Domain actions
export * from './tags'
export * from './statuses'
export * from './boards'
export * from './roadmaps'
export * from './posts'
export * from './public-posts'
export * from './comments'
export * from './subscriptions'
export * from './user'
export * from './settings'
export * from './admin'
export * from './onboarding'
