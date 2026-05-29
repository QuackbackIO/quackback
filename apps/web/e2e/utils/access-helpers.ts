/**
 * Helpers for the board-access-matrix e2e suite.
 *
 * - `loginViaMagicLink` establishes a session for ANY email on a context
 *   (Better-auth's magic-link verify auto-creates the user if new), mirroring
 *   the admin global-setup flow. Lets a single public project drive multiple
 *   real identities (admin / authenticated user / segment member).
 * - `setupAccessFixtures` / `setWorkspaceAnon` drive deterministic DB setup via
 *   CLI scripts (same pattern as db-helpers.ts).
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
