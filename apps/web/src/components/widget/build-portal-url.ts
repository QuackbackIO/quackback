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
