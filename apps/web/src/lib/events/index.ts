/**
 * Event system barrel exports
 *
 * IMPORTANT: This barrel export only includes types and event builders.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions (processEvent, processIntegration, processUserNotification),
 * import directly from './event-service', './integration-service', or './notification-service'
 * in server-only code (server functions, API routes, etc.)
 *
 * For dispatching events, import directly from './dispatch' in server-only code.
 */

// Types (no DB dependency)
export * from './types'

// Event builders (no DB dependency - only uses crypto)
export * from './event-builder'
