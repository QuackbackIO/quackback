import type { OidcSignInButton } from '@/lib/shared/oidc-sign-in-button'

/** Sign-in methods the workspace actually allows, in the shape
 *  `PortalAuthFormInline` already consumes on the portal. */
export interface AccountAuthConfig {
  found: boolean
  oauth: Record<string, boolean | undefined>
  openSignup?: boolean
  oidcProviders?: OidcSignInButton[]
  registeredAuthProviders?: string[]
  twoFactorRequired?: boolean
  /** The methods an account that already exists here can sign in with. */
  signInOAuth?: Record<string, boolean | undefined>
}

/** The slice of the client settings payload the account step reads. */
interface AccountSettings {
  publicAuthConfig?: {
    oauth: Record<string, boolean | undefined>
    openSignup?: boolean
    twoFactor?: { required?: boolean }
  }
  publicPortalConfig?: { oidcProviders?: OidcSignInButton[] }
}

/**
 * The sign-in methods the account step may offer on this workspace.
 *
 * A workspace with no settings row has not been set up, and nothing has turned
 * a sign-in provider on for it. The shipped auth default lists Google and
 * GitHub as on, but that is the toggle's default, not credentials anyone
 * configured, and the portal only ever shows providers filtered by their
 * credentials. Before setup the one method that works is a password, which is
 * also the only way the first admin's account is created.
 */
export function accountAuthConfig(
  settings: AccountSettings | null | undefined,
  registeredAuthProviders: string[] | undefined
): AccountAuthConfig {
  const auth = settings?.publicAuthConfig
  return {
    signInOAuth: auth?.oauth ?? registeredSignIn(registeredAuthProviders),
    found: !!auth,
    oauth: auth?.oauth ?? { password: true },
    openSignup: auth?.openSignup,
    oidcProviders: settings?.publicPortalConfig?.oidcProviders,
    registeredAuthProviders,
    twoFactorRequired: auth?.twoFactor?.required ?? false,
  }
}

/**
 * How an account that already exists can sign back in before setup finishes:
 * a password, plus whatever the auth runtime registered. The runtime is the
 * judge because it is what the buttons call; before setup it registers no
 * social provider, since those are opt-in and nothing has opted in yet.
 */
function registeredSignIn(registered: string[] | undefined): Record<string, boolean> {
  return { password: true, ...Object.fromEntries((registered ?? []).map((id) => [id, true])) }
}
