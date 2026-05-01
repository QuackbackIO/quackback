/**
 * Database helpers for E2E tests
 *
 * These utilities run CLI scripts to query the database for test-specific operations.
 * They should ONLY be used in test environments.
 */

import { execSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Get the most recent live magic-link token for an email from the
 * verification table. Used by e2e tests to complete the magic-link
 * sign-in flow without going through real email delivery.
 */
export function getMagicLinkToken(email: string): string {
  const scriptPath = resolve(__dirname, '../scripts/get-magic-link-token.ts')

  try {
    const result = execSync(`dotenv -e ../../.env -- bun "${scriptPath}" "${email}"`, {
      encoding: 'utf-8',
      cwd: resolve(__dirname, '../..'), // apps/web directory
    })

    return result.trim()
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(`Failed to get magic-link token: ${err.stderr || err.message}`, {
      cause: error,
    })
  }
}

/**
 * Ensure a test user has the required role for E2E testing
 *
 * This is a test utility that ensures the demo user has the 'admin' role
 * even if the database wasn't properly seeded. Should only be used in tests.
 *
 * @param email - The email address of the user
 * @param role - The role to ensure (default: 'admin')
 */
export function ensureTestUserHasRole(email: string, role: string = 'admin'): void {
  const scriptPath = resolve(__dirname, '../scripts/ensure-role.ts')

  try {
    execSync(`dotenv -e ../../.env -- bun "${scriptPath}" "${email}" "${role}"`, {
      encoding: 'utf-8',
      cwd: resolve(__dirname, '../..'), // apps/web directory
    })
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(`Failed to ensure user role: ${err.stderr || err.message}`, { cause: error })
  }
}
