/**
 * The router's URL rewrite for a portal section on its own hostname: `/` on
 * help.acme.com shows the help center's home while the address bar keeps `/`.
 *
 * The server learns the home from the section host middleware, through the
 * request context. The browser reads it from the `data-section-home` mark the
 * server put on the document (the root document keeps rendering it from the
 * bootstrap, which works it out from the same host), so client-side
 * navigations to `/` match the server.
 */
import { createIsomorphicFn, getGlobalStartContext } from '@tanstack/react-start'

export const SECTION_HOME_ATTRIBUTE = 'data-section-home'

/** The URL to match in place of `url`, or undefined to leave it be. */
export function rewriteToSectionHome(url: URL, home: string | null): URL | undefined {
  if (!home || url.pathname !== '/') return undefined
  const rewritten = new URL(url)
  rewritten.pathname = home
  return rewritten
}

/** The home the server marked the document with; only a path on this site counts. */
export function sectionHomeFromDocument(doc: Document): string | null {
  const home = doc.documentElement.getAttribute(SECTION_HOME_ATTRIBUTE)
  return home && /^\/[a-z]/.test(home) ? home : null
}

const currentSectionHome = createIsomorphicFn()
  .server((): string | null => {
    try {
      const context = getGlobalStartContext() as { sectionHome?: string } | undefined
      return context?.sectionHome ?? null
    } catch {
      // Outside a request (or before the request middleware ran).
      return null
    }
  })
  .client((): string | null => sectionHomeFromDocument(document))

export const sectionHomeRewrite = {
  input: ({ url }: { url: URL }) => rewriteToSectionHome(url, currentSectionHome()),
}
