import { widgetHandoffPath } from '@/lib/shared/routing'

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
