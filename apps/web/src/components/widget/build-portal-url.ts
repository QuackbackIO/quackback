/**
 * Build the portal URL for "View on feedback board" navigation.
 *
 * Only includes the OTT (one-time token) when the user is identified.
 * Transferring an anonymous session via OTT would overwrite any existing
 * portal session cookie, effectively logging the user out.
 */
export function buildPortalUrl(params: {
  origin: string
  boardSlug: string
  postId: string
  isIdentified: boolean
  ott: string | null
}): string {
  const { origin, boardSlug, postId, isIdentified, ott } = params
  let url = `${origin}/b/${boardSlug}/posts/${postId}`
  if (isIdentified && ott) {
    url += `?ott=${encodeURIComponent(ott)}`
  }
  return url
}

/** Append an OTT to a portal URL when the widget visitor is identified. */
export function appendWidgetOtt(url: string, isIdentified: boolean, ott: string | null): string {
  if (!isIdentified || !ott) return url
  const next = new URL(url)
  next.searchParams.set('ott', ott)
  return next.toString()
}
