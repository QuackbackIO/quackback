/**
 * Better Auth 1.7 moved genericOAuth callbacks from
 * `/oauth2/callback/:providerId` onto the social `/callback/:id` path.
 * Incoming `/api/auth/oauth2/callback/:id` requests are rewritten to the
 * new path so customer IdP registrations keep working. Hooks must accept
 * both templates; after the rewrite `params.id` carries the provider id.
 */

export const LEGACY_OIDC_CALLBACK_PATH = '/oauth2/callback/:providerId'
export const SOCIAL_CALLBACK_PATH = '/callback/:id'

export function isOidcCallbackPath(path?: string): boolean {
  return path === LEGACY_OIDC_CALLBACK_PATH || path === SOCIAL_CALLBACK_PATH
}

export function oidcCallbackProviderId(ctx: {
  path?: string
  params?: Record<string, unknown>
}): string | null {
  if (ctx.path === LEGACY_OIDC_CALLBACK_PATH) {
    return typeof ctx.params?.providerId === 'string' ? ctx.params.providerId : null
  }
  if (ctx.path === SOCIAL_CALLBACK_PATH) {
    return typeof ctx.params?.id === 'string' ? ctx.params.id : null
  }
  return null
}
