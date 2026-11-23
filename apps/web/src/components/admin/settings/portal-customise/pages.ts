/**
 * The preview's pages, and the This page section each one has.
 */
import type { PreviewEditTarget } from '@/components/public/preview-draft-context'

export type CustomisePageId = 'feedback' | 'roadmap' | 'changelog' | 'help'

/** The panel's sections. */
export type SectionId = 'import' | 'colours' | 'font' | 'header' | 'css' | 'welcome' | 'hc-home'

export interface CustomisePage {
  id: CustomisePageId
  label: string
  path: string
  /** What This page holds for it: a section, or a note. */
  section: 'welcome' | 'hc-home' | 'note'
}

/** The page a portal address belongs to, or null for one outside the list. */
export function pageOfPath(path: string): CustomisePageId | null {
  if (path === '/roadmap' || path.startsWith('/roadmap/')) return 'roadmap'
  if (path === '/changelog' || path.startsWith('/changelog/')) return 'changelog'
  if (path === '/hc' || path.startsWith('/hc/')) return 'help'
  if (path === '/' || path.startsWith('/b/')) return 'feedback'
  return null
}

/**
 * The pages to offer. A page whose product is off is hidden, and so is the
 * Help Center when it lives on its own domain (it would leave this origin).
 */
export function customisePages({
  flags,
  feedbackLabel,
  helpCenterDomain,
}: {
  flags: { feedback?: boolean; changelog?: boolean; helpCenter?: boolean } | undefined
  /** The Feedback tab's own label, when the admin renamed it. */
  feedbackLabel?: string
  helpCenterDomain: boolean
}): CustomisePage[] {
  const pages: CustomisePage[] = []
  if (flags?.feedback !== false) {
    pages.push({
      id: 'feedback',
      label: feedbackLabel || 'Feedback',
      path: '/',
      section: 'welcome',
    })
    pages.push({ id: 'roadmap', label: 'Roadmap', path: '/roadmap', section: 'note' })
  }
  if (flags?.changelog) {
    pages.push({ id: 'changelog', label: 'Changelog', path: '/changelog', section: 'note' })
  }
  if (flags?.helpCenter && !helpCenterDomain) {
    pages.push({ id: 'help', label: 'Help Center', path: '/hc', section: 'hc-home' })
  }
  return pages
}

/** The section a click in the preview opens, and the page it needs. */
export function sectionForTarget(target: PreviewEditTarget): {
  section: SectionId
  page: CustomisePageId | null
} {
  switch (target) {
    case 'welcome':
      return { section: 'welcome', page: 'feedback' }
    case 'hc-home':
      return { section: 'hc-home', page: 'help' }
    case 'colours':
      return { section: 'colours', page: null }
    case 'type':
      return { section: 'font', page: null }
    default:
      return { section: 'header', page: null }
  }
}
