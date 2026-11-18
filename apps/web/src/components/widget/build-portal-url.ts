import { widgetHandoffPath } from '@/lib/shared/routing'
import { sectionUrl, type SectionOrigins } from '@/lib/shared/section-links'

/**
 * Build the portal URL for "View on feedback board" navigation.
 *
 * Identified visitors go through `/auth/widget-handoff` so the teammate
 * cookie guard runs. Anonymous visitors get the resource URL with no OTT
 * (an anonymous OTT would overwrite an existing portal cookie).
 */

export function buildPortalUrl(params: {
  origin: string
  boardSlug: string
  postId: string
  isIdentified: boolean
  ott: string | null
}): string {
  const { origin, boardSlug, postId, isIdentified, ott } = params
  const dest = `/b/${boardSlug}/posts/${postId}`
  if (isIdentified && ott) {
    return `${origin}${widgetHandoffPath(ott, dest)}`
  }
  return `${origin}${dest}`
}

/** Send an identified visitor through widget-handoff; leave anonymous URLs unchanged. */
export function appendWidgetOtt(url: string, isIdentified: boolean, ott: string | null): string {
  if (!isIdentified || !ott) return url
  const next = new URL(url)
  const returnTo = `${next.pathname}${next.search}`
  return `${next.origin}${widgetHandoffPath(ott, returnTo)}`
}

/**
 * "View on portal" for a changelog entry. An anonymous visitor goes straight
 * to the changelog's own host when it has one. An identified visitor signs in
 * through widget-handoff on the widget's origin first; it lands on the entry
 * there, and the section host middleware carries the session on to the
 * changelog's host through the section handoff.
 */
export function widgetChangelogUrl(params: {
  origin: string
  entryId: string
  origins: SectionOrigins | null | undefined
  isIdentified: boolean
  ott: string | null
}): string {
  const path = `/changelog/${params.entryId}`
  if (params.isIdentified && params.ott) {
    return `${params.origin}${widgetHandoffPath(params.ott, path)}`
  }
  return params.origins ? sectionUrl('changelog', path, params.origins) : `${params.origin}${path}`
}
