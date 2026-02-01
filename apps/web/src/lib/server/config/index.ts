/**
 * Centralized Configuration Module
 *
 * Provides type-safe access to all environment variables with Zod validation.
 */

import { z } from 'zod'

// ============================================================================
// Schema Definition
// ============================================================================

const serverEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().optional(),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().optional(),

  // Application
  ROOT_URL: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Quackback <noreply@quackback.io>'),

  // OAuth providers
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Integrations
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

// ============================================================================
// Configuration Singleton
// ============================================================================

let _config: ServerEnv | null = null

/**
 * Get validated server configuration.
 * Validates on first access and caches the result.
 * Throws if required environment variables are missing.
 */
export function getConfig(): ServerEnv {
  if (_config) return _config

  const result = serverEnvSchema.safeParse(process.env)

  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    console.error('[Config] Validation failed:\n' + errors.join('\n'))
    throw new Error('Invalid environment configuration')
  }

  _config = result.data
  return _config
}

/**
 * Reset config cache (for testing).
 */
export function resetConfig(): void {
  _config = null
}

// ============================================================================
// Convenience Accessors
// ============================================================================

export const config = {
  /** Get the full validated environment object */
  get env() {
    return getConfig()
  },

  /** Check if running in development mode */
  get isDev() {
    return getConfig().NODE_ENV === 'development'
  },

  /** Check if running in production mode */
  get isProd() {
    return getConfig().NODE_ENV === 'production'
  },
}

// Re-export schema for testing
export { serverEnvSchema }
