/**
 * Database helpers for E2E tests
 *
 * These utilities run CLI scripts to query the database for test-specific operations.
 * They should ONLY be used in test environments.
 */

import { execFileSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Run an e2e CLI script from apps/web and return its trimmed stdout.
 * `bun --env-file` loads the repo-root .env for local runs. Do not shell out
 * to `dotenv`: GitHub runners ship a Ruby dotenv first on PATH that rejects -e.
 * Failures rethrow with the script's stderr so the real cause surfaces.
 */
function runScript(scriptFile: string, args: string[], label: string): string {
  const scriptPath = resolve(__dirname, '../scripts', scriptFile)

  try {
    const result = execFileSync('bun', ['--env-file=../../.env', scriptPath, ...args], {
      encoding: 'utf-8',
      cwd: resolve(__dirname, '../..'), // apps/web directory
    })
    return result.trim()
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(`Failed to ${label}: ${err.stderr || err.message}`, { cause: error })
  }
}

/**
 * Get the most recent live magic-link token for an email from the
 * verification table. Used by e2e tests to complete the magic-link
 * sign-in flow without going through real email delivery.
 */
export function getMagicLinkToken(email: string): string {
  return runScript('get-magic-link-token.ts', [email], 'get magic-link token')
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
  runScript('ensure-role.ts', [email, role], 'ensure user role')
}

/**
 * Get the most recent live sign-in OTP code for an email (verification rows
 * shaped `sign-in-otp-<email>` -> `<code>:<attempts>`). Several public specs
 * import this to complete the OTP sign-in form; the `host` parameter is
 * accepted for their call sites but unused (single-workspace test instance).
 */
export function getOtpCode(email: string, _host?: string): string {
  return runScript('get-otp-code.ts', [email], 'get OTP code')
}

/**
 * Enable (or disable) the conversation surfaces: the supportInbox flag, the
 * widget messenger (master + surface + tab), and the portal Support tab.
 * Also busts the cached workspace settings so the change is live at once.
 */
export function setSupportSurfaces(enabled: boolean = true): void {
  runScript('set-support-surfaces.ts', [enabled ? 'on' : 'off'], 'set support surfaces')
}

export interface SeededConversation {
  /** TypeID string (conversation_...) used in /admin/inbox?c= and /support/ URLs. */
  conversationId: string
  visitorPrincipalId: string
  subject: string
  /** The two visitor messages, oldest first. */
  messages: [string, string]
}

/**
 * Seed one open 'messenger' conversation with two visitor messages. With no
 * email the visitor is a fresh anonymous principal; with an email the
 * conversation is owned by that user's principal (for portal /support specs).
 */
export function seedConversation(subject: string, visitorEmail?: string): SeededConversation {
  const args = visitorEmail ? [subject, visitorEmail] : [subject]
  return JSON.parse(
    runScript('seed-conversation.ts', args, 'seed conversation')
  ) as SeededConversation
}

/**
 * Clear the magic-link sign-in rate-limit buckets (signin:magiclink:*) so
 * repeated e2e runs from one machine don't 429 the sign-in POST. The script
 * is the single owner of that key prefix.
 */
export function clearSigninRateLimit(): void {
  runScript('clear-signin-rate-limit.ts', [], 'clear signin rate limit')
}

/**
 * Enable the magic-link sign-in method (settings.auth_config oauth.magicLink,
 * absent = off post-unified-auth) and bust the settings caches. The whole e2e
 * suite signs in via magic link, and a fresh seed does not enable it, so
 * global-setup provisions it idempotently before authenticating.
 */
export function enableMagicLinkMethod(): void {
  runScript('enable-magic-link-method.ts', [], 'enable magic-link method')
}

/**
 * Pick a mention-eligible principal from the seed dataset to use as a target
 * in @-mention e2e flows. Seed names are randomised per run, so we resolve
 * the displayName + principalId at test time and excludes the demo user
 * (who is normally the one doing the mentioning).
 */
export function getMentionTarget(excludeEmail: string = 'demo@example.com'): {
  principalId: string
  displayName: string
} {
  return JSON.parse(runScript('get-mention-target.ts', [excludeEmail], 'get mention target')) as {
    principalId: string
    displayName: string
  }
}
