/**
 * Helpers for the board-access-matrix e2e suite.
 *
 * - `loginViaMagicLink` establishes a session for ANY email on a context
 *   (Better-auth's magic-link verify auto-creates the user if new), mirroring
 *   the admin global-setup flow. Lets a single public project drive multiple
 *   real identities (admin / authenticated user / segment member).
 * - `setupAccessFixtures` / `setWorkspaceAnon` / `setPortalAuthMethods` drive
 *   deterministic DB setup via CLI scripts (same pattern as db-helpers.ts).
 * - `flushMagicLinkRateLimit` clears the per-email rate-limit keys in Redis so
 *   repeated e2e runs don't hit the sign-in rate limiter.
 */
import { execFileSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { expect, type BrowserContext } from '@playwright/test'
import { getMagicLinkToken, ensureTestUserHasRole } from './db-helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))

function runScript(scriptRelPath: string, args: string[]): string {
  const scriptPath = resolve(__dirname, scriptRelPath)
  // execFileSync (no shell) so test args can't be interpreted as shell syntax.
  return execFileSync('dotenv', ['-e', '../../.env', '--', 'bun', scriptPath, ...args], {
    encoding: 'utf-8',
    cwd: resolve(__dirname, '../..'), // apps/web
  }).trim()
}

export interface BoardFixture {
  slug: string
  postId: string
}

export interface AccessFixtures {
  segmentId: string
  memberPrincipalId: string
  boards: {
    public: BoardFixture
    allanon: BoardFixture
    segview: BoardFixture
    mixedseg: BoardFixture
    private: BoardFixture
    mod: BoardFixture
  }
}

/**
 * Provision the e2e-* boards + segment and add `memberEmail` to the segment.
 * The member must already exist (sign them in once before calling this).
 */
export function setupAccessFixtures(memberEmail: string): AccessFixtures {
  return JSON.parse(
    runScript('../scripts/setup-access-fixtures.ts', [memberEmail])
  ) as AccessFixtures
}

/** Flip the workspace `features.allowAnonymous` master switch. */
export function setWorkspaceAnon(enabled: boolean): void {
  runScript('../scripts/set-workspace-anon.ts', [String(enabled)])
}

/**
 * Disable or restore portal public auth methods (password, magicLink, OAuth
 * providers) in `settings.portal_config.oauth`. Used by tests that need to
 * verify the team break-glass form is still served when the portal offers no
 * public sign-in methods. Always call `setPortalAuthMethods('restore')` in a
 * `finally` block so subsequent tests/dev aren't left with a broken portal.
 */
export function setPortalAuthMethods(action: 'disable' | 'restore' | 'enable-magic-link'): void {
  runScript('../scripts/set-portal-auth-methods.ts', [action])
}

/**
 * Flush the magic-link per-email rate-limit keys from Redis/Dragonfly so that
 * repeated e2e runs on the same email addresses don't hit the sign-in limiter.
 * No-op when no keys exist.
 */
export function flushMagicLinkRateLimit(): void {
  // Scan for all rate-limit keys, then delete each one. Two separate execFileSync
  // calls avoid a shell pipeline (no shell-interpolation risk).
  const scan = execFileSync(
    'docker',
    ['exec', 'quackback-dragonfly', 'redis-cli', '--scan', '--pattern', 'signin:magiclink:*'],
    { encoding: 'utf-8' }
  )
  const keys = scan.split('\n').map((k) => k.trim()).filter(Boolean)
  for (const key of keys) {
    execFileSync('docker', ['exec', 'quackback-dragonfly', 'redis-cli', 'del', key], {
      stdio: 'pipe',
    })
  }
}

/**
 * Sign `email` into `context` via the magic-link flow (auto-creates the user if
 * new). After this the context's cookies carry the session. Pass `role:'admin'`
 * to also promote the principal to admin (for team-identity tests).
 */
export async function loginViaMagicLink(
  context: BrowserContext,
  email: string,
  opts: { role?: 'admin' | 'member' | 'user' } = {}
): Promise<void> {
  const send = await context.request.post('/api/auth/sign-in/magic-link', {
    data: { email, callbackURL: '/' },
  })
  expect(send.ok(), `magic-link send for ${email}`).toBeTruthy()

  const token = getMagicLinkToken(email)
  expect(token.length).toBeGreaterThan(8)

  const verify = await context.request.get(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/')}`,
    { maxRedirects: 5 }
  )
  expect(verify.ok(), `magic-link verify for ${email}`).toBeTruthy()

  if (opts.role) ensureTestUserHasRole(email, opts.role)
}
