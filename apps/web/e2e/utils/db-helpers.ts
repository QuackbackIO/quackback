/**
 * Database helpers for E2E tests
 *
 * These utilities run CLI scripts to query the database for test-specific operations.
 * They should ONLY be used in test environments.
 */

import { execSync } from 'child_process'
import { resolve } from 'path'

/**
 * Get OTP code for an email address from the database
 *
 * Executes a CLI script that queries the database directly,
 * ensuring proper environment variables are loaded.
 *
 * @param email - The email address to get the OTP for
 * @param host - The host (domain) to resolve the workspace
 * @returns The OTP code or throws if not found/expired
 */
export function getOtpCode(email: string, host: string): string {
  const scriptPath = resolve(__dirname, '../scripts/get-otp.ts')

  try {
    // Execute the script with dotenv to load environment variables
    const result = execSync(`dotenv -e ../../.env -- bun "${scriptPath}" "${email}" "${host}"`, {
      encoding: 'utf-8',
      cwd: resolve(__dirname, '../..'), // apps/web directory
    })

    return result.trim()
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(`Failed to get OTP code: ${err.stderr || err.message}`)
  }
}
