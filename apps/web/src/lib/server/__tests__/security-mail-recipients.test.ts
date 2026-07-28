import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Capability-bearing mail must never follow a user-settable address.
 *
 * `principal.contactEmail` has two unverified writers — an agent typing an
 * address into the inbox, and a visitor typing one into a pre-chat form — so a
 * password reset that fell back to it would be an account-takeover path: set
 * the contact address, trigger a reset, receive it.
 *
 * The compiler catches the cross-class mistake at a `mailSecure` call, and the
 * ESLint rule catches a static import of a security sender. Neither reaches the
 * six sites that use `await import('@quackback/email')`, because a dynamic
 * import is invisible to `no-restricted-imports` and the brand is erased at the
 * `to: string` boundary. This scan is the backstop for that gap, in the genre
 * of `no-renamed-table-refs.test.ts`.
 */

/** Senders whose payload can grant or recover account access. */
const SECURITY_SENDERS = [
  'sendPasswordResetEmail',
  'sendMagicLinkEmail',
  'sendNewSignInEmail',
  'sendRecoveryCodeUsedEmail',
  'sendInvitationEmail',
  'sendPortalInviteEmail',
] as const

/**
 * The only files allowed to name them. Every entry is a deliberate decision;
 * adding one means asserting that the file resolves its recipient through
 * `resolveAccountRecipient` or `sealedRecipient` and never reads a contact
 * address.
 */
const ALLOWED = new Set([
  'lib/server/auth/index.ts', // password reset — account class
  'lib/server/auth/hooks.ts', // new-device alert — account class
  'lib/server/auth/email-signin.ts', // magic link + OTP — sealed class
  'lib/server/functions/recovery-codes-consume.ts', // recovery alert — account class
  'lib/server/functions/admin.ts', // team invite create + resend — sealed class
  'lib/server/functions/portal-invites.ts', // portal invite create + resend — sealed class
])

// Anchored to this file, not to `process.cwd()`: the suite runs from the repo
// root as well as from `apps/web`, and a cwd-relative root either throws (no
// such directory) or, worse, scans the wrong tree and passes vacuously.
const SRC = resolve(fileURLToPath(import.meta.url), '../../../..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(full))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|gen)\./.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Comments stripped, because prose is not a code path. `admin.ts` legitimately
 * explains lead dedup in a doc comment, and flagging that would train people to
 * silence the guard rather than heed it.
 */
const code = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const filesNaming = (symbol: string): string[] =>
  sources(SRC)
    .filter((f) => code(f).includes(symbol))
    .map((f) => relative(SRC, f))

describe('security mail cannot follow a settable address', () => {
  it('actually scans the tree', () => {
    // Without this the suite has a silent failure mode: a scan that walks the
    // wrong directory finds no offenders and reports success. Every assertion
    // below is only as good as this one.
    const all = sources(SRC)
    expect(all.length).toBeGreaterThan(500)
    expect(all.some((f) => f.endsWith('lib/server/auth/index.ts'))).toBe(true)
  })

  it('only allow-listed files name a security sender', () => {
    const offenders: string[] = []
    for (const sender of SECURITY_SENDERS) {
      for (const file of filesNaming(sender)) {
        if (!ALLOWED.has(file)) offenders.push(`${file} names ${sender}`)
      }
    }
    expect(
      offenders,
      `A new file sends capability-bearing mail. Resolve its recipient through ` +
        `resolveAccountRecipient or sealedRecipient, then add it to ALLOWED:\n${offenders.join('\n')}`
    ).toEqual([])
  })

  it('no allow-listed file reads a contact address', () => {
    // The single most direct statement of the rule. A file that sends a reset
    // and also touches contactEmail is one edit away from joining them.
    const offenders = [...ALLOWED].filter((f) => code(join(SRC, f)).includes('contactEmail'))
    expect(
      offenders,
      `These files send capability-bearing mail AND reference contactEmail:\n${offenders.join('\n')}`
    ).toEqual([])
  })

  it('every allow-listed file resolves through the module', () => {
    const offenders = [...ALLOWED].filter((f) => {
      const src = code(join(SRC, f))
      return !src.includes('resolveAccountRecipient') && !src.includes('sealedRecipient')
    })
    expect(
      offenders,
      `These files send capability-bearing mail without resolving a recipient:\n${offenders.join('\n')}`
    ).toEqual([])
  })
})
