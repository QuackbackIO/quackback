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
    found: !!auth,
    oauth: auth?.oauth ?? { password: true },
    openSignup: auth?.openSignup,
    oidcProviders: settings?.publicPortalConfig?.oidcProviders,
    registeredAuthProviders,
    twoFactorRequired: auth?.twoFactor?.required ?? false,
  }
}
