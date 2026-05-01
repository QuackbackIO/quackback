import { getAuth, getMagicLinkToken } from './index'

interface MintOptions {
  /** Recipient email — must already exist in better-auth (or pass
   * disableSignUp: false to auto-create). */
  email: string
  /** Path the user lands on after a *successful* verify. */
  callbackPath: string
  /** Path the user lands on after a *failed* verify (token consumed
   * by an email scanner, expired, etc). Defaults to `callbackPath`
   * for backwards compat with invitations, but new callers should
   * point at `/admin/login` so failed clicks don't double-bounce
   * through a deep route guard. */
  errorCallbackPath?: string
  /** Workspace's public origin, e.g. `https://acme.quackback.io`. */
  portalUrl: string
}

/**
 * Mints a `/verify-magic-link?token=…&callbackURL=…&errorCallbackURL=…`
 * URL that signs the recipient in on click. Used by:
 *   - team invitations (admin.ts → sendInvitationFn)
 *   - Cloud bootstrap (api/cloud/bootstrap.ts)
 *
 * The plugin's `sendMagicLink` callback in auth/index.ts stashes the
 * token in an in-memory map keyed by lowercase email; we drain it
 * via `getMagicLinkToken` rather than letting better-auth dispatch
 * an actual email — the caller emails the URL itself.
 */
export async function mintMagicLinkUrl(opts: MintOptions): Promise<string> {
  const auth = await getAuth()

  // Calling auth.api.signInMagicLink directly skips the Request /
  // Response construction overhead of going through `auth.handler`.
  // The sendMagicLink callback still fires (better-auth invokes it
  // unconditionally on the email path), so getMagicLinkToken below
  // works the same. Headers carry the workspace's Origin/Host so
  // better-auth's redirect builder roots correctly.
  await auth.api.signInMagicLink({
    body: { email: opts.email, callbackURL: opts.callbackPath },
    headers: new Headers({
      Origin: opts.portalUrl,
      Host: new URL(opts.portalUrl).host,
    }),
  })

  const token = getMagicLinkToken(opts.email)
  if (!token) {
    throw new Error('Magic link token not captured — sendMagicLink callback may not have fired')
  }

  const errorPath = opts.errorCallbackPath ?? opts.callbackPath
  const verifyUrl = new URL('/verify-magic-link', opts.portalUrl)
  verifyUrl.searchParams.set('token', token)
  verifyUrl.searchParams.set('callbackURL', `${opts.portalUrl}${opts.callbackPath}`)
  verifyUrl.searchParams.set('errorCallbackURL', `${opts.portalUrl}${errorPath}`)
  return verifyUrl.toString()
}
