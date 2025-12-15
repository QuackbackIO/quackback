/**
 * Database utilities
 */

/**
 * Generate a random UUID for use as a primary key.
 * Uses the Node.js crypto module for secure random generation.
 */
export function generateId(): string {
  return crypto.randomUUID()
}
