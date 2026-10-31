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

const PAGE_PATHS: Record<PortalPageType, string> = {
  feedback: '/feedback',
  roadmap: '/roadmap',
  changelog: '/changelog',
  help: '/hc',
  support: '/support',
  status: '/status',
}

export type PortalLanding = { kind: 'home' } | { kind: 'feed' } | { kind: 'redirect'; to: string }

/** What `/` shows. */
export function portalLanding(settings: PortalPathSettings, gates: PortalPageGates): PortalLanding {
  if (settings.engine !== 'v2') return { kind: 'feed' }
  if (settings.nav.home.on) return { kind: 'home' }
  const first = settings.nav.items.find(
    (item): item is Extract<typeof item, { shown: boolean }> =>
      item.type !== 'link' && item.shown && gates[item.type]
  )
  if (!first || first.type === 'feedback') return { kind: 'feed' }
  return { kind: 'redirect', to: PAGE_PATHS[first.type] }
}

/** The feed's address: `/` while it is the landing page, else `/feedback`. */
export function portalFeedbackPath(
  settings: PortalPathSettings,
  gates: PortalPageGates
): '/' | '/feedback' {
  return portalLanding(settings, gates).kind === 'feed' ? '/' : '/feedback'
}

/**
 * The feedback pages a sitemap lists: the root unless it only redirects, the
 * feed at its one address, and the roadmap. Other pages list themselves.
 */
export function portalSitemapPaths(settings: PortalPathSettings, gates: PortalPageGates): string[] {
  const landing = portalLanding(settings, gates)
  const paths: string[] = []
  if (landing.kind === 'home' || (landing.kind === 'feed' && gates.feedback)) paths.push('/')
  if (gates.feedback) {
    if (landing.kind !== 'feed') paths.push('/feedback')
    paths.push('/roadmap')
  }
  return paths
}

/** The feed's own search parameters, which an old link to `/` may carry. */
const FEED_SEARCH_KEYS = [
  'board',
  'search',
  'sort',
  'status',
  'tagIds',
  'minVotes',
  'dateFrom',
  'responded',
  'owner',
  'segmentIds',
  'view',
] as const

/** Whether a search is a feed's, so `/` can send it on to the feed. */
export function hasFeedSearch(search: Record<string, unknown>): boolean {
  return FEED_SEARCH_KEYS.some((key) => search[key] !== undefined)
}
