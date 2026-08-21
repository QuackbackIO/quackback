import type { OrgAuthConfig } from './auth-dialog'
import { DEFAULT_AUTH_CONFIG } from '@/lib/shared/types/settings'

/**
 * Everything the portal's sign-in dialog needs to know about this workspace.
 *
 * Built in one place because the portal builds it TWICE — once for the access
 * gate's overlay and once for the ordinary layout — and two copies of the same
 * projection drift silently: a field added to one is simply absent from the
 * other, and an absent field is a form that renders as though the workspace had
 * never answered.
 *
 * `found` is the one field the two callers still differ on, so it stays a
 * parameter: the gate can render before a settings row exists.
 */
export interface PortalAuthDialogConfigInput {
  publicAuthConfig?: {
    oauth?: Record<string, boolean | undefined>
    twoFactor?: { required?: boolean }
  } | null
  publicPortalConfig?: {
    oidcProviders?: { id: string; name: string }[]
    openSignup?: boolean
  } | null
  registeredAuthProviders: string[]
  /** False before any settings row exists; the gate can be rendered then. */
  found: boolean
}

export function buildPortalAuthDialogConfig(input: PortalAuthDialogConfigInput): OrgAuthConfig {
  return {
    found: input.found,
    oauth: input.publicAuthConfig?.oauth ?? DEFAULT_AUTH_CONFIG.oauth,
    oidcProviders: input.publicPortalConfig?.oidcProviders,
    registeredAuthProviders: input.registeredAuthProviders,
    twoFactorRequired: input.publicAuthConfig?.twoFactor?.required ?? false,
    // The PORTAL's answer, already resolved on the server against the
    // workspace-wide fallback. Without it the form cannot know the workspace is
    // refusing new accounts, so it walks a visitor to a code-entry screen and
    // leaves them waiting for mail that will never be sent. `undefined` is
    // preserved rather than defaulted: it means "not known yet", which is a
    // different thing from "closed".
    openSignup: input.publicPortalConfig?.openSignup,
  }
}
