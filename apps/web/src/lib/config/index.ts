/**
 * Centralized Configuration Module
 *
 * Provides type-safe access to all environment variables with Zod validation.
 * Works in both Cloudflare Workers and Node.js/Bun environments.
 *
 * Cloudflare Workers supports process.env natively when nodejs_compat is enabled
 * (which is already configured in wrangler.jsonc with compatibility_date >= 2025-04-01).
 */

import { z } from 'zod'

// ============================================================================
// Schema Definition
// ============================================================================

const serverEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().optional(),
  CLOUD_CATALOG_DATABASE_URL: z.string().optional(),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().optional(),

  // Application
  ROOT_URL: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  EDITION: z.enum(['self-hosted', 'cloud']).optional(),

  // Email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Quackback <noreply@quackback.io>'),

  // Cloud multi-tenant
  CLOUD_TENANT_BASE_DOMAIN: z.string().optional(),
  CLOUD_NEON_DEFAULT_REGION: z.string().default('aws-us-east-1'),

  // OAuth providers
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().default('common'),

  // Integrations
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),

  // Session transfer (cloud)
  CLOUD_SESSION_TRANSFER_SECRET: z.string().optional(),

  // Billing base URL (cloud edition - external website)
  CLOUD_BILLING_URL: z.string().default('https://www.quackback.io'),
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

  /** Check if running in cloud edition */
  get isCloud() {
    return getConfig().EDITION === 'cloud'
  },

  /** Check if running in self-hosted edition */
  get isSelfHosted() {
    return getConfig().EDITION !== 'cloud'
  },

  /** Check if multi-tenant mode is enabled (has catalog database) */
  get isMultiTenant() {
    return Boolean(getConfig().CLOUD_CATALOG_DATABASE_URL)
  },
}

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * Get the external billing URL for cloud users.
 * Uses path-based workspace ID: /workspaces/{workspaceId}/billing
 */
export function getBillingUrl(workspaceId?: string): string {
  const baseUrl = getConfig().CLOUD_BILLING_URL
  if (workspaceId) {
    return `${baseUrl}/workspaces/${workspaceId}/billing`
  }
  return baseUrl
}

// Re-export schema for testing
export { serverEnvSchema }
