/**
 * The portal's /sitemap.xml, per host. The primary domain lists the sections
 * it serves itself; a section on its own host (news.acme.com for the
 * changelog) lists only that section, on that host. The help center's pages
 * are in its own sitemap (/hc/sitemap.xml), so they are never listed here.
 */
import type { SitemapUrl } from '@/lib/server/sitemap'
import type { PortalSection } from './custom-domains'
import { toIsoDateOnly } from './utils/date'
import {
  sectionServedAt,
  sectionsOnPrimary,
  sectionUrl,
  type SectionOrigins,
} from './section-links'

/** The sections the sitemap on this host lists. */
export function portalSitemapSections(
  host: string | null,
  origins: SectionOrigins
): ReadonlySet<PortalSection> {
  const hostSection = sectionServedAt(host, origins)
  return new Set(hostSection ? [hostSection] : sectionsOnPrimary(origins))
}

export function buildPortalSitemapUrls({
  origins,
  sections,
  flags,
  changelogEntries,
  posts,
}: {
  origins: SectionOrigins
  sections: ReadonlySet<PortalSection>
  flags: { feedback: boolean; changelog: boolean }
  changelogEntries: ReadonlyArray<{ id: string; updatedAt: Date }>
  posts: ReadonlyArray<{ id: string; boardSlug: string; updatedAt: Date }>
}): SitemapUrl[] {
  const urls: SitemapUrl[] = []
  const listed = (section: PortalSection, on: boolean) => on && sections.has(section)

  if (listed('feedback', flags.feedback)) urls.push({ loc: sectionUrl('feedback', '/', origins) })
  if (listed('roadmap', flags.feedback)) {
    urls.push({ loc: sectionUrl('roadmap', '/roadmap', origins) })
  }
  if (listed('changelog', flags.changelog)) {
    urls.push({ loc: sectionUrl('changelog', '/changelog', origins) })
    for (const entry of changelogEntries) {
      urls.push({
        loc: sectionUrl('changelog', `/changelog/${entry.id}`, origins),
        lastmod: toIsoDateOnly(entry.updatedAt),
      })
    }
  }
  if (listed('feedback', flags.feedback)) {
    for (const post of posts) {
      urls.push({
        loc: sectionUrl('feedback', `/b/${post.boardSlug}/posts/${post.id}`, origins),
        lastmod: toIsoDateOnly(post.updatedAt),
      })
    }
  }
  return urls
}
