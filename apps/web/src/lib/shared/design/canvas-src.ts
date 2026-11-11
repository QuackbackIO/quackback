/**
 * The address the builder's canvas loads, kept apart from the canvas so the
 * builder's route can start loading the first page before the builder's own
 * code arrives.
 */
import type { CanvasVisitor } from './designer-frame'
import { designerPages, pagePath, type DesignerPage } from './outline'
import { locationOfPath, type PortalPageGates } from './paths'
import { samplePath, type SamplePage } from './sample-pages'
import type { PortalDesign } from './schema'

/**
 * Set on a frame's `<html>` when the server drew its page with the saved
 * draft (`draft` below), so a review frame shows it at once rather than
 * waiting until the draft is posted in.
 */
export const DRAFT_DRAWN_ATTRIBUTE = 'data-qb-draft'

/**
 * The address the canvas loads: the page as a preview, in the theme and
 * language asked for, signed in or out; or the page's sample. With `draft`,
 * the server draws the page with the saved draft, for the publish review.
 */
export function canvasSrc({
  page,
  theme,
  locale,
  sort,
  postPath = null,
  visitor = 'in',
  sample = null,
  draft = false,
}: {
  page: DesignerPage
  theme: 'light' | 'dark'
  locale: string
  sort: 'trending' | 'top' | 'new'
  /** The item the page shows, such as the post on the post page. */
  postPath?: string | null
  visitor?: CanvasVisitor
  /** The page drawn from sample content instead. */
  sample?: SamplePage | null
  /** Drawn by the server with the saved draft, not the published design. */
  draft?: boolean
}): string {
  const search = new URLSearchParams({ theme, preview: 'true', lang: locale, designer: '1' })
  if (draft) search.set('design', 'draft')
  // A sample is served to the designer alone, so it is drawn for them as themselves.
  if (sample) return `${samplePath(sample)}?${search}`
  // The root shows Home whatever the saved design leads with.
  if (page === 'home') search.set('page', 'home')
  if (page === 'feedback') search.set('sort', sort)
  if (visitor === 'out') search.set('visitor', 'out')
  // An item can carry its own search, such as a board on the feed.
  const [path, own] = pagePath(page, postPath).split('?') as [string, string | undefined]
  for (const [name, value] of new URLSearchParams(own ?? '')) search.set(name, value)
  return `${path}?${search}`
}

/**
 * The address the canvas loads first, as the builder opens: the page someone
 * came from (else the first the builder shows), signed out, in English and
 * the theme the design shows first. Null for the post page with no post,
 * which the builder finds first.
 */
export function firstCanvasSrc(
  design: PortalDesign,
  gates: PortalPageGates,
  returnPath: string
): string | null {
  const pages = designerPages(design, gates)
  const start = locationOfPath(returnPath, design.nav.home.on)
  const chosen = start?.page ?? pages[0] ?? 'feedback'
  const page = pages.includes(chosen) ? chosen : (pages[0] ?? 'feedback')
  const item = start?.page === page ? (start.item ?? null) : null
  if (page === 'post' && !item) return null
  return canvasSrc({
    page,
    theme: design.mode === 'dark' ? 'dark' : 'light',
    locale: 'en',
    sort: design.pages.feedback.defaultSort,
    postPath: item,
    visitor: 'out',
  })
}
