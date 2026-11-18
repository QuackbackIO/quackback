/**
 * Which icon a page shows in the browser tab.
 *
 * Pages a workspace's own customers visit (portal, help center, status,
 * changelog, the shared sign-in pages) carry the workspace's brand, often on
 * the workspace's own domain. Quackback's own pages, the ones the workspace's
 * team works in, carry Quackback's icon. Every page declares one icon, so a
 * client-side move between the two kinds swaps the tab icon too.
 */

/** Quackback's icon, served from public/. */
export const QUACKBACK_ICON = '/favicon.ico'

/** Shown on customer-facing pages when the workspace has no logo. */
export const DEFAULT_WORKSPACE_ICON = '/logo.png'

// Pages for the workspace's team rather than its customers.
const QUACKBACK_PAGES = ['/admin', '/onboarding', '/apps', '/device', '/oauth', '/complete-signup']

function isQuackbackPage(pathname: string): boolean {
  return QUACKBACK_PAGES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))
}

interface IconSettings {
  faviconData?: { url: string } | null
  brandingData?: { logoUrl: string | null } | null
}

/** The workspace's icon: its dedicated favicon, then its logo, then the default. */
export function workspaceIconHref(settings: IconSettings | null | undefined): string {
  return settings?.faviconData?.url || settings?.brandingData?.logoUrl || DEFAULT_WORKSPACE_ICON
}

export function pageIconHref(pathname: string, settings: IconSettings | null | undefined): string {
  return isQuackbackPage(pathname) ? QUACKBACK_ICON : workspaceIconHref(settings)
}
