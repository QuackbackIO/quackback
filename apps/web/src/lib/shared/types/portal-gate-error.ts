/**
 * Shape of the portal access-gate, returned as loader data by `_portal.tsx`
 * when a visitor is unauthenticated/unauthorized. Lives in lib/shared so it can
 * be imported without React or router deps.
 */

import type { SupportedLocale } from '@/lib/shared/i18n'

export interface PortalAccessGateError {
  /** Discriminant identifying the gate in the loader data. */
  type: 'portal-access-gate'
  reason: 'unauthenticated' | 'unauthorized'
  workspaceName: string
  logoUrl: string | null
  themeStyles: string
  customCss: string
  /**
   * The structured theme config's light-mode font-family, so the gate can
   * dynamically load the workspace's chosen branding font the same way the
   * accessible portal does (see useBrandingFont) even when customCss doesn't
   * carry a --font-sans of its own (e.g. a workspace that only picked a
   * preset). Null when unset.
   */
  configFontSans: string | null
  /**
   * Locale resolved server-side (Accept-Language) so the gate's auth dialog
   * renders under the same PortalIntlProvider the portal uses. Optional: older
   * serialized payloads omit it, and the gate falls back to the default locale.
   */
  locale?: SupportedLocale
  /**
   * The signed-in visitor's email when reason === 'unauthorized'. Lets the
   * overlay tell the visitor exactly which account is being blocked so they
   * can sign out and try a different one (typical case: signed in with a
   * personal Gmail when the portal allows @acme.com only). Null/undefined
   * when reason === 'unauthenticated' — no session means no email to show.
   */
  userEmail?: string | null
  /** Pending destination to navigate to once access is granted post-sign-in. */
  callbackUrl?: string
  /** When set, the gate opens the sign-in dialog automatically on mount. */
  autoOpenSignin?: 'login' | 'signup'
  authConfig: {
    found: boolean
    oauth: Record<string, boolean | undefined>
    oidcProviders?: { id: string; name: string }[]
    /** All registered auth provider ids — lets the gate's sign-in form show
     *  the email input for a routed-only IdP that renders no public button. */
    registeredAuthProviders?: string[]
    /** Workspace requires 2FA — drives inline enrollment after password sign-in. */
    twoFactorRequired?: boolean
  }
}
