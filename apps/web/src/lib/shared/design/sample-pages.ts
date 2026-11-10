/**
 * The pages the designer can draw with sample content: a part that is off
 * has nothing of its own to show, Status shows nothing until it is
 * published, and Support shows a visitor only their own conversations.
 * Samples live at their own designer-only address.
 */
import type { PortalPageType } from './paths'

export const SAMPLE_PAGES = [
  'feedback',
  'roadmap',
  'changelog',
  'help',
  'support',
  'status',
] as const satisfies readonly PortalPageType[]
export type SamplePage = (typeof SAMPLE_PAGES)[number]

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
