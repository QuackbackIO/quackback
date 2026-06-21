import { isSafeCallbackUrl } from './routing'

export interface AuthPromptParams {
  signin?: 'login' | 'signup'
  prompt?: 'login'
  callbackUrl?: string
  error?: string
}

/** Reads the auth-prompt query params off a portal-root search object.
 *  `signin=1` → login, `signin=signup` → signup. Unsafe callbackUrls are dropped. */
export function parseAuthPromptSearch(search: Record<string, unknown>): AuthPromptParams {
  const out: AuthPromptParams = {}
  if (search.signin === '1') out.signin = 'login'
  else if (search.signin === 'signup') out.signin = 'signup'
  if (search.prompt === 'login') out.prompt = 'login'
  if (typeof search.callbackUrl === 'string' && isSafeCallbackUrl(search.callbackUrl)) {
    out.callbackUrl = search.callbackUrl
  }
  if (typeof search.error === 'string') out.error = search.error
  return out
}

/** Builds the redirect that replaces a former `/auth/login` target:
 *  the portal root with the dialog requested and the destination carried. */
export function buildSigninRedirect(
  callbackUrl: string,
  opts: { mode?: 'login' | 'signup'; error?: string } = {}
): { to: '/'; search: Record<string, string> } {
  const search: Record<string, string> = {
    signin: opts.mode === 'signup' ? 'signup' : '1',
    callbackUrl,
  }
  if (opts.error) search.error = opts.error
  return { to: '/', search }
}
