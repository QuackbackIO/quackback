import { isSafeCallbackUrl } from './routing'

export interface AuthPromptParams {
  mode?: 'login' | 'signup'
  callbackUrl?: string
  error?: string
}

/** Reads the auth-prompt query params off a portal-root search object.
 *  `auth=signin` → login, `auth=signup` → signup. Unsafe callbackUrls are dropped. */
export function parseAuthPromptSearch(search: Record<string, unknown>): AuthPromptParams {
  const out: AuthPromptParams = {}
  if (search.auth === 'signin') out.mode = 'login'
  else if (search.auth === 'signup') out.mode = 'signup'
  if (typeof search.callbackUrl === 'string' && isSafeCallbackUrl(search.callbackUrl)) {
    out.callbackUrl = search.callbackUrl
  }
  if (typeof search.error === 'string') out.error = search.error
  return out
}

/** Shared implementation for auth/admin login redirect targets.
 *  Validates callbackUrl and delegates to buildSigninRedirect. */
export function safeSigninRedirect(
  d: { callbackUrl?: string; error?: string },
  fallback: string,
  opts?: { mode?: 'login' | 'signup' }
) {
  const callbackUrl = isSafeCallbackUrl(d.callbackUrl) ? (d.callbackUrl as string) : fallback
  return buildSigninRedirect(callbackUrl, { mode: opts?.mode, error: d.error })
}

/** Builds the redirect that replaces a former `/auth/login` target:
 *  the portal root with the dialog requested and the destination carried. */
export function buildSigninRedirect(
  callbackUrl: string,
  opts: { mode?: 'login' | 'signup'; error?: string } = {}
): { to: '/'; search: Record<string, string> } {
  const search: Record<string, string> = {
    auth: opts.mode === 'signup' ? 'signup' : 'signin',
    callbackUrl,
  }
  if (opts.error) search.error = opts.error
  return { to: '/', search }
}
