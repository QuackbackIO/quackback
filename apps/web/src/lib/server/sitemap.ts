/**
 * Pure sitemap XML builders.
 * Follows the Sitemaps protocol: https://www.sitemaps.org/protocol.html
 *
 * - Max 50,000 URLs per sitemap file
 * - Uses lastmod (W3C date format) instead of priority/changefreq (ignored by crawlers)
 * - Generates a sitemap index when URL count exceeds the per-file limit
 */

export const MAX_URLS_PER_SITEMAP = 50_000

export interface SitemapUrl {
  loc: string
  lastmod?: string
}

export function toW3CDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildSitemap(urls: SitemapUrl[]): string {
  const urlEntries = urls
    .map(
      (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
  </url>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`
}

export function buildSitemapIndex(baseUrl: string, totalPages: number): string {
  const entries = Array.from({ length: totalPages }, (_, i) => {
    const page = i + 1
    return `  <sitemap>
    <loc>${escapeXml(`${baseUrl}/sitemap.xml?page=${page}`)}</loc>
  </sitemap>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`
}

/**
 * Given all collected URLs, returns the appropriate XML response body.
 * - Under the limit: returns a single sitemap
 * - Over the limit with no page param: returns a sitemap index
 * - Over the limit with a page param: returns the requested page
 * - Invalid page: returns null
 */
export function renderSitemap(
  allUrls: SitemapUrl[],
  baseUrl: string,
  page: number | null
): string | null {
  // Single sitemap when under the protocol limit
  if (allUrls.length <= MAX_URLS_PER_SITEMAP && page === null) {
    return buildSitemap(allUrls)
  }

  const totalPages = Math.ceil(allUrls.length / MAX_URLS_PER_SITEMAP)

  // Index mode
  if (page === null) {
    return buildSitemapIndex(baseUrl, totalPages)
  }

  if (page < 1 || page > totalPages) {
    return null
  }

  const start = (page - 1) * MAX_URLS_PER_SITEMAP
  return buildSitemap(allUrls.slice(start, start + MAX_URLS_PER_SITEMAP))
}
