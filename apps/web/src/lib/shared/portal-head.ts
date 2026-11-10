/**
 * What a portal page tells the browser and a link preview about itself: the
 * site's name as the header shows it, each page's name and description in
 * the workspace's main language, the favicon, and the share card.
 *
 * Head text is read by crawlers and link previews, not by one visitor, so it
 * is written in the workspace's main language (the portal localisation rule:
 * the owner's words fall back to the main language), never the visitor's.
 */
import { normalizeLocale, DEFAULT_LOCALE, type SupportedLocale } from './i18n'
import type { PortalDesignView } from './design/view'
import { shareCardPath, type ShareCardPage } from './design/share-card'

/** The settings a portal head reads. */
export interface PortalHeadSettings {
  name?: string | null
  portalDesign?: PortalDesignView
  helpCenterConfig?: { locales?: { default?: string } } | null
  brandingData?: { logoUrl?: string | null } | null
  faviconData?: { url: string } | null
  /** The head's words in the main language, from the server (portal-head-words.ts). */
  portalHeadWords?: PortalHeadTemplates
}

/** The site's name as the header shows it: the Brand kit's title, else the workspace's name. */
export function portalSiteName(settings: PortalHeadSettings | null | undefined): string {
  const design = settings?.portalDesign
  const title = design?.engine === 'v2' ? design.logo.name?.trim() : undefined
  return title || settings?.name || 'Quackback'
}

/**
 * The workspace's main language. Until it has a setting of its own, the
 * help center's default language is the one place a workspace states it.
 */
export function portalMainLanguage(
  settings: PortalHeadSettings | null | undefined
): SupportedLocale {
  const stated = settings?.helpCenterConfig?.locales?.default
  return (stated && normalizeLocale(stated)) || DEFAULT_LOCALE
}

type Page = 'feedback' | 'roadmap' | 'changelog' | 'status' | 'help'
type Words = {
  pages: Record<Page, string>
  /** The portal's own description, and Feedback's. */
  portal: (name: string) => string
  feedback: (name: string) => string
  roadmap: (name: string) => string
  changelog: (name: string) => string
  entry: (title: string, name: string) => string
  status: (name: string) => string
  incident: (title: string, name: string) => string
  post: (title: string, board: string) => string
}

/**
 * The head's words as templates: {name} the site's name, {title} an entry's
 * or post's title, {board} a board's name. The server puts the main
 * language's in the workspace settings (portalHeadWords); English is the
 * fallback here, so the page's script carries one language, not all of them.
 */
export interface PortalHeadTemplates {
  pages: Record<Page, string>
  portal: string
  feedback: string
  roadmap: string
  changelog: string
  entry: string
  status: string
  incident: string
  post: string
}

const ENGLISH: PortalHeadTemplates = {
  pages: {
    feedback: 'Feedback',
    roadmap: 'Roadmap',
    changelog: 'Changelog',
    status: 'Status',
    help: 'Help Center',
  },
  portal: 'Share feedback, vote on posts and follow the {name} roadmap.',
  feedback: 'Share feedback and vote on posts for {name}.',
  roadmap: 'See what {name} is working on and what comes next.',
  changelog: 'The latest updates from {name}.',
  entry: '{title}. An update from {name}.',
  status: 'Live status and incident history for {name}.',
  incident: '{title}. A status update from {name}.',
  post: '{title}. Vote and comment on this post in {board}.',
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(name|title|board)\}/g, (_, key: string) => values[key] ?? '')

/** The head's words in the workspace's main language. */
export function portalHeadWords(settings: PortalHeadSettings | null | undefined): Words {
  const t = settings?.portalHeadWords ?? ENGLISH
  return {
    pages: t.pages,
    portal: (name) => fill(t.portal, { name }),
    feedback: (name) => fill(t.feedback, { name }),
    roadmap: (name) => fill(t.roadmap, { name }),
    changelog: (name) => fill(t.changelog, { name }),
    entry: (title, name) => fill(t.entry, { title, name }),
    status: (name) => fill(t.status, { name }),
    incident: (title, name) => fill(t.incident, { title, name }),
    post: (title, board) => fill(t.post, { title, board }),
  }
}

/** A page's title: its name, then the site's. */
export const pageTitle = (settings: PortalHeadSettings | null | undefined, page: Page) =>
  `${portalHeadWords(settings).pages[page]} - ${portalSiteName(settings)}`

/**
 * The favicon: the design's own, then the brand icon, then the workspace's
 * favicon and logo, then the default.
 */
export function portalFavicon(settings: PortalHeadSettings | null | undefined): string {
  const design = settings?.portalDesign
  const icons = design?.engine === 'v2' ? design.icons : undefined
  return (
    icons?.favicon ||
    icons?.mark ||
    settings?.faviconData?.url ||
    settings?.brandingData?.logoUrl ||
    '/logo.png'
  )
}

const absolute = (path: string, baseUrl: string | null | undefined) => {
  if (!baseUrl) return path
  try {
    return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
  } catch {
    return path
  }
}

/**
 * The image a shared link shows, absolute: the design's own share image,
 * else its drawn card (with the page's name), else null for a portal on the
 * legacy theme, which keeps its own.
 */
export function portalShareImage(
  settings: PortalHeadSettings | null | undefined,
  baseUrl: string | null | undefined,
  page?: ShareCardPage
): string | null {
  const design = settings?.portalDesign
  if (design?.engine !== 'v2' || !design.icons) return null
  if (design.icons.shareImage) return absolute(design.icons.shareImage, baseUrl)
  if (!design.icons.card) return null
  const pageName = page ? portalHeadWords(settings).pages[page] : null
  return absolute(
    shareCardPath(design.icons.card, portalSiteName(settings), page, pageName),
    baseUrl
  )
}

/** The meta that points a link preview at a page's own card, to sit over the portal's. */
export function pageShareMeta(
  settings: PortalHeadSettings | null | undefined,
  baseUrl: string | null | undefined,
  page: ShareCardPage
): Array<Record<string, string>> {
  const design = settings?.portalDesign
  // The design's own share image is the same on every page; the portal's head has it.
  if (design?.engine !== 'v2' || design.icons?.shareImage) return []
  const image = portalShareImage(settings, baseUrl, page)
  return image ? [{ property: 'og:image', content: image }] : []
}

/** The workspace settings a route's head reads, from the root match's context. */
export function headSettings(
  matches: ReadonlyArray<{ context?: unknown }> | undefined
): PortalHeadSettings | null {
  return (
    (matches?.[0]?.context as { settings?: PortalHeadSettings | null } | undefined)?.settings ??
    null
  )
}

/**
 * The browser chrome's colour (theme-color): the page colour, one per mode
 * the visitor may see, told apart by media query; one alone when the mode is fixed.
 */
export function portalThemeColors(
  design: PortalDesignView | undefined,
  forced: 'light' | 'dark' | undefined
): Array<{ content: string; media?: string }> {
  const colours = design?.engine === 'v2' ? design.icons?.themeColor : undefined
  if (!colours) return []
  if (forced) {
    const content = colours[forced]
    return content ? [{ content }] : []
  }
  return (['light', 'dark'] as const).flatMap((mode) => {
    const content = colours[mode]
    return content ? [{ content, media: `(prefers-color-scheme: ${mode})` }] : []
  })
}
