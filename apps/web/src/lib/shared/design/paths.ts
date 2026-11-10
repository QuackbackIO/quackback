/**
 * Where the portal starts and where the feed lives. With Home on, `/` is Home
 * and the feed is at `/feedback`. With Home off, `/` is the first page the
 * menu shows: the feed itself when that is Feedback, else a redirect to it.
 * The legacy theme keeps the feed at `/`. Portal links to the feed take its
 * path from here, never a literal `'/'`.
 */
import type { PortalDesign } from './schema'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { isStatusPagePublished } from '@/lib/shared/status-settings'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'

/** The root: Home, or the first page in the menu. The logo always links here. */
export const PORTAL_LANDING = '/'

/** The built-in pages the menu can show, each behind its module. */
export type PortalPageType = 'feedback' | 'roadmap' | 'changelog' | 'help' | 'support' | 'status'

/** Whether each page exists for this workspace (its module on, its page published). */
export type PortalPageGates = Record<PortalPageType, boolean>

/** What the page gates read from the workspace settings. */
export interface PageGateSettings {
  featureFlags?: Parameters<typeof isProductEnabled>[0]
  statusConfig?: (Parameters<typeof isStatusPagePublished>[1] & { audience?: string }) | null
  portalConfig?: Parameters<typeof isPortalSupportSurfaceEnabled>[1]
}

/**
 * Which pages exist for this viewer. Each gate folds in its module and, for
 * Status, whether it is published and who may see it; a menu can hide a page
 * but never show one its gate closes.
 */
export function portalPageGates(
  settings: PageGateSettings | null | undefined,
  signedIn: boolean
): PortalPageGates {
  const flags = settings?.featureFlags
  const feedback = isProductEnabled(flags, 'feedback')
  const statusAudience = settings?.statusConfig?.audience ?? 'public'
  return {
    feedback,
    roadmap: feedback,
    changelog: isProductEnabled(flags, 'changelog'),
    help: isProductEnabled(flags, 'helpCenter'),
    support: isPortalSupportSurfaceEnabled(flags, settings?.portalConfig),
    status:
      isStatusPagePublished(flags, settings?.statusConfig) &&
      (statusAudience === 'public' || signedIn),
  }
}

/** What the paths need from the workspace's design. */
export type PortalPathSettings = { engine: 'legacy' } | { engine: 'v2'; nav: PortalDesign['nav'] }

export const PAGE_PATHS: Record<PortalPageType, string> = {
  feedback: '/feedback',
  roadmap: '/roadmap',
  changelog: '/changelog',
  help: '/hc',
  support: '/support',
  status: '/status',
}

export type PortalLanding = { kind: 'home' } | { kind: 'feed' } | { kind: 'redirect'; to: string }

/**
 * What `/` shows. The Appearance preview asks for Home with `page=home`, to
 * show a draft's Home whatever the saved design leads with.
 */
export function portalLanding(
  settings: PortalPathSettings,
  gates: PortalPageGates,
  search: Record<string, unknown> = {}
): PortalLanding {
  if (settings.engine !== 'v2') return { kind: 'feed' }
  if (previewsHome(search)) return { kind: 'home' }
  if (settings.nav.home.on) return { kind: 'home' }
  const first = settings.nav.items.find(
    (item): item is Extract<typeof item, { shown: boolean }> =>
      item.type !== 'link' && item.shown && gates[item.type]
  )
  if (!first || first.type === 'feedback') return { kind: 'feed' }
  return { kind: 'redirect', to: PAGE_PATHS[first.type] }
}

/** Whether a search is a preview frame's: the designer's canvas or the Appearance preview. */
export function isPreviewSearch(search: Record<string, unknown>): boolean {
  return search.preview === true || search.preview === 1 || search.preview === '1'
}

/** Whether a search is the Appearance preview's, asking for Home. */
export function previewsHome(search: Record<string, unknown>): boolean {
  return isPreviewSearch(search) && search.page === 'home'
}

/** The feed's address: `/` while it is the landing page, else `/feedback`. */
export function portalFeedbackPath(
  settings: PortalPathSettings,
  gates: PortalPageGates
): '/' | '/feedback' {
  return portalLanding(settings, gates).kind === 'feed' ? '/' : '/feedback'
}

/** A page the designer can show: Home, one of the portal's own pages, or a post. */
export type DesignerPage = 'home' | PortalPageType | 'post'

// Kept here, not in the designer's outline, so the portal shell can read a
// path's page without loading the outline.
/** Where the canvas is: a page, and the item it shows, such as a post or an entry, if any. */
export interface CanvasLocation {
  page: DesignerPage
  /** The item's own address; null for the page itself. */
  item: string | null
}

/** The page a portal path shows and its item, or null for one the designer does not draw. */
export function locationOfPath(path: string, homeOn: boolean): CanvasLocation | null {
  const pathname = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/'
  if (pathname === '/') return { page: homeOn ? 'home' : 'feedback', item: null }
  if (/^\/b\/[^/]+\/posts\/[^/]+$/.test(pathname)) return { page: 'post', item: pathname }
  const found = (Object.entries(PAGE_PATHS) as Array<[PortalPageType, string]>).find(
    ([, at]) => pathname === at || pathname.startsWith(`${at}/`)
  )
  if (!found) return null
  const [page, at] = found
  return { page, item: pathname === at ? null : pathname }
}

/** The page a portal path shows, a detail page under its own, or null for one the designer does not draw. */
export function pageOfPath(path: string, homeOn: boolean): DesignerPage | null {
  return locationOfPath(path, homeOn)?.page ?? null
}

/** The address the canvas loads a page at: the item it shows, else the page's own. */
export function pagePath(page: DesignerPage, item: string | null = null): string {
  if (item) return item
  if (page === 'post') return '/'
  return page === 'home' ? '/' : PAGE_PATHS[page]
}

/**
 * The page a designer page's background is kept under, or null for one with
 * none: Home, a post, or one of the portal's own pages (an item page is kept
 * under its own page). The same pages as DESIGN_OPTIONS.backgroundPage, kept
 * here so the portal's shell does not load the background drawing code.
 */
export function backgroundPageOf(page: string | null | undefined): DesignerPage | null {
  if (page === 'home' || page === 'post') return page
  return page && Object.hasOwn(PAGE_PATHS, page) ? (page as PortalPageType) : null
}
