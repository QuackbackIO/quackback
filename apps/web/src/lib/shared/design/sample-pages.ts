/**
 * The pages the designer can draw with sample content: a part that is off
 * has nothing of its own to show, Status shows nothing until it is
 * published, and Support shows a visitor only their own conversations.
 * Not found is the portal's page for an address with nothing at it, which
 * a visitor only meets by chance. Samples live at their own designer-only address.
 */
import type { PortalPageType } from './paths'

/** The portal's pages that have samples. */
export const PAGE_SAMPLES = [
  'feedback',
  'roadmap',
  'changelog',
  'help',
  'support',
  'status',
] as const satisfies readonly PortalPageType[]

/** The not-found page's sample: words only, no content. */
export const NOT_FOUND_SAMPLE = 'not-found'

export const SAMPLE_PAGES = [...PAGE_SAMPLES, NOT_FOUND_SAMPLE] as const
export type SamplePage = (typeof SAMPLE_PAGES)[number]

/** Whether a sample is one of the portal's own pages, rather than the not-found page. */
export const isPageSample = (page: SamplePage): page is (typeof PAGE_SAMPLES)[number] =>
  page !== NOT_FOUND_SAMPLE

/** A sample's name in the page switcher. */
export const SAMPLE_NAMES: Record<SamplePage, string> = {
  feedback: 'Feedback',
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  help: 'Help Center',
  support: 'Support',
  status: 'Status',
  'not-found': 'Not found',
}

/**
 * Pages that offer a sample even while their part is on: Status, unpublished
 * or quiet, and Support, whose list is only ever the viewer's own.
 */
export const ALWAYS_SAMPLED: readonly SamplePage[] = ['support', 'status']

export function isSamplePage(page: string): page is SamplePage {
  return (SAMPLE_PAGES as readonly string[]).includes(page)
}

/** Where the designer's frame loads a page's sample. */
export function samplePath(page: SamplePage): string {
  return `/design-sample/${page}`
}
