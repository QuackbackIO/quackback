/**
 * Tenant path utilities for navigation
 *
 * Use these instead of hardcoded paths to ensure consistency across the app.
 * All paths are relative (start with /) and work with the proxy rewrite system.
 *
 * The proxy rewrites these paths internally to /s/[orgSlug]/... but the browser
 * URL stays as the original path (e.g., /admin stays as /admin in the URL bar).
 */

export const tenantPaths = {
  // Public portal
  home: '/',
  roadmap: '/roadmap',
  post: (boardSlug: string, postId: string) => `/b/${boardSlug}/posts/${postId}`,

  // Auth
  login: '/login',
  signup: '/signup',
  sso: (providerId: string) => `/sso/${providerId}`,

  // Admin dashboard
  admin: '/admin',
  adminFeedback: '/admin/feedback',
  adminRoadmap: '/admin/roadmap',
  adminUsers: '/admin/users',
  adminGettingStarted: '/admin/getting-started',

  // Admin settings
  adminSettings: '/admin/settings',
  adminSettingsTeam: '/admin/settings/team',
  adminSettingsSecurity: '/admin/settings/security',
  adminSettingsBoards: '/admin/settings/boards',
  adminSettingsBoard: (slug: string) => `/admin/settings/boards/${slug}`,
  adminSettingsBoardAccess: (slug: string) => `/admin/settings/boards/${slug}/access`,
  adminSettingsBoardExport: (slug: string) => `/admin/settings/boards/${slug}/export`,
  adminSettingsBoardImport: (slug: string) => `/admin/settings/boards/${slug}/import`,
  adminSettingsBranding: '/admin/settings/branding',
  adminSettingsStatuses: '/admin/settings/statuses',
  adminSettingsPortalAuth: '/admin/settings/portal-auth',
  adminSettingsBilling: '/admin/settings/billing',
  adminSettingsSsoNew: '/admin/settings/security/sso/new',
  adminSettingsSsoNewTemplate: (templateId: string) =>
    `/admin/settings/security/sso/new/${templateId}`,

  // Admin auth (team member login/signup)
  adminLogin: '/admin/login',
  adminSignup: '/admin/signup',

  // User settings
  settings: '/settings',
  settingsProfile: '/settings/profile',
  settingsPreferences: '/settings/preferences',

  // Onboarding
  onboarding: '/onboarding',
} as const

export type TenantPath = (typeof tenantPaths)[keyof typeof tenantPaths]

/**
 * Convert internal rewritten path to external path
 *
 * The proxy rewrites /admin/settings to /s/[orgSlug]/admin/settings internally,
 * but usePathname() returns the internal path. This function strips the /s/[orgSlug]
 * prefix to get the external path for comparison with hrefs.
 *
 * Example: /s/acme/admin/settings -> /admin/settings
 */
export function toExternalPath(internalPath: string): string {
  // Match /s/[orgSlug]/... and extract the rest
  const match = internalPath.match(/^\/s\/[^/]+(.*)$/)
  return match ? match[1] || '/' : internalPath
}
