/**
 * Client-side helpers for the declarative Quackback config lock.
 *
 * Mirrors `lib/server/config-file/managed-paths.isPathManaged` so
 * client form components don't import server-only modules. Pulled into
 * its own file rather than re-exporting because TanStack Start trips
 * on cross-boundary imports of any file that touches the server tree.
 */

export const MANAGED_PATHS = {
  WORKSPACE_NAME: 'workspace.name',
  WORKSPACE_SLUG: 'workspace.slug',
  WORKSPACE_USE_CASE: 'workspace.useCase',
  TIER_LIMITS: 'tierLimits',
  AUTH_OAUTH_GOOGLE: 'auth.oauth.google',
  AUTH_OAUTH_GITHUB: 'auth.oauth.github',
  AUTH_OPEN_SIGNUP: 'auth.openSignup',
} as const

export type ManagedPath = (typeof MANAGED_PATHS)[keyof typeof MANAGED_PATHS] | (string & {})

export function isPathManagedFromBootstrap(path: string, managed: string[]): boolean {
  for (const m of managed) {
    if (path === m) return true
    if (path.startsWith(`${m}.`)) return true
  }
  return false
}
