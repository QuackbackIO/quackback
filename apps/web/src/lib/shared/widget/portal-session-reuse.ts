/**
 * Whether the widget frame may adopt the visitor's portal session.
 *
 * The portal session cookie is SameSite=Lax, so a browser sends it on any
 * same-site request, including an iframe navigation from a page on a sibling
 * subdomain. That page is a different origin from the instance, and the widget
 * reports the signed-in user to whichever page embeds it, so the session is
 * reused only when the embedding page is the instance's own origin (the admin
 * live preview, or a page the instance itself serves). Every other embedder
 * identifies visitors with a signed identity token.
 *
 * The decision reads the Fetch Metadata request headers and fails closed:
 * - `Sec-Fetch-Site` must be exactly `same-origin`. A missing header (an older
 *   browser) or any other value means no reuse.
 * - `Sec-Fetch-Mode` must be `navigate`. Calls the frame makes after it loads
 *   (a loader re-run, for instance) are same-origin fetches whoever embeds the
 *   frame, so only the document navigation itself says who the embedder is.
 *
 * This is the first gate. Fetch Metadata describes who started a navigation,
 * so a navigation the frame starts itself (a reload, a link inside it) also
 * passes; the frame makes the final check in the browser, adopting the
 * session only under a parent page on its own origin (widget-frame.ts).
 */
export function shouldReusePortalSession(fetchMetadata: {
  site: string | null | undefined
  mode: string | null | undefined
}): boolean {
  return fetchMetadata.site === 'same-origin' && fetchMetadata.mode === 'navigate'
}
