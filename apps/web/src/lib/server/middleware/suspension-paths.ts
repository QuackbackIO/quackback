/**
 * Pure helpers for the suspension guard: just the exempt-path list and
 * the prefix-match function. Imported by `__root.tsx` (which runs in
 * the client bundle), so this file must never reach DB / Redis / any
 * specifier denied by the import-protection plugin.
 *
 * The actual suspension-enforcement entry point lives in
 * `./suspension-guard.ts`, which dynamic-imports settings.service.
 * Keeping these two concerns in separate files is what breaks the
 * static-import chain `__root.tsx → suspension-guard → settings.service
 * → redis → ioredis`, which the bundler's import-protection plugin
 * walks across both static and dynamic edges.
 */

/**
 * Path prefixes that stay reachable while the workspace is suspended
 * or deleting. The list is intentionally small: only what users need
 * to get back in (login, OAuth completion) and what health checks need
 * (`/api/health`, `/.well-known/`).
 *
 * Whole-path equality OR prefix-match. `/api/auth/` matches itself
 * and any descendant such as `/api/auth/sign-in/email`.
 */
export const SUSPENSION_EXEMPT_PATHS = [
  '/admin/login',
  '/admin/signup',
  '/auth/',
  '/api/auth/',
  '/api/health',
  '/oauth/',
  '/.well-known/',
  '/complete-signup/',
  // Magic-link landing — without this, a suspended workspace's owner
  // can't click an email link back into the portal.
  '/verify-magic-link',
] as const

export function isSuspensionExempt(p: string): boolean {
  return SUSPENSION_EXEMPT_PATHS.some((prefix) => p === prefix || p.startsWith(prefix))
}
