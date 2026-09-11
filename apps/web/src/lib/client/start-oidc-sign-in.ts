import { authClient } from '@/lib/client/auth-client'

/**
 * Start an OIDC / generic-OAuth sign-in through Better Auth 1.7's social path.
 * `signIn.oauth2({ providerId })` is gone; generic providers share `signIn.social`.
 */
export function startOidcSignIn(args: {
  providerId: string
  callbackURL: string
  errorCallbackURL?: string
  loginHint?: string
  disableRedirect?: boolean
}) {
  return authClient.signIn.social({
    provider: args.providerId,
    callbackURL: args.callbackURL,
    errorCallbackURL: args.errorCallbackURL,
    loginHint: args.loginHint,
    disableRedirect: args.disableRedirect,
  })
}
