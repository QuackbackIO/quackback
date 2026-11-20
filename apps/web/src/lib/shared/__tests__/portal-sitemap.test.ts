import { describe, expect, it } from 'vitest'
import { buildPortalSitemapUrls, portalSitemapSections } from '../portal-sitemap'
import { allOnPrimary } from '../section-links'

const PRIMARY = 'https://acme.example.com'
const UPDATED = new Date('2026-11-01T12:00:00.000Z')

const content = {
  flags: { feedback: true, changelog: true },
  changelogEntries: [{ id: 'changelog_1', updatedAt: UPDATED }],
  posts: [{ id: 'post_1', boardSlug: 'ideas', updatedAt: UPDATED }],
}

function locs(origins = allOnPrimary(PRIMARY), host: string | null = 'acme.example.com') {
  return buildPortalSitemapUrls({
    origins,
    sections: portalSitemapSections(host, origins),
    ...content,
  }).map((url) => url.loc)
}

describe('portal sitemap', () => {
  it('lists every section on the primary domain while none has its own host', () => {
    expect(locs()).toEqual([
      `${PRIMARY}/`,
      `${PRIMARY}/roadmap`,
      `${PRIMARY}/changelog`,
      `${PRIMARY}/changelog/changelog_1`,
      `${PRIMARY}/b/ideas/posts/post_1`,
    ])
  })

  it('leaves a section with its own host off the primary domain', () => {
    const origins = { ...allOnPrimary(PRIMARY), changelog: 'https://news.acme.com' }
    expect(locs(origins)).toEqual([
      `${PRIMARY}/`,
      `${PRIMARY}/roadmap`,
      `${PRIMARY}/b/ideas/posts/post_1`,
    ])
  })

  it("lists only a section host's own section, on that host, its home as /", () => {
    const origins = { ...allOnPrimary(PRIMARY), changelog: 'https://news.acme.com' }
    expect(locs(origins, 'news.acme.com')).toEqual([
      'https://news.acme.com/',
      'https://news.acme.com/changelog/changelog_1',
    ])
  })

  it('lists nothing of its own for a section host whose pages have their own sitemap', () => {
    const origins = { ...allOnPrimary(PRIMARY), help: 'https://help.acme.com' }
    expect(locs(origins, 'help.acme.com')).toEqual([])
  })

  it('stamps entries and posts with the day they last changed', () => {
    const urls = buildPortalSitemapUrls({
      origins: allOnPrimary(PRIMARY),
      sections: portalSitemapSections(null, allOnPrimary(PRIMARY)),
      ...content,
    })
    expect(urls.find((u) => u.loc.endsWith('/posts/post_1'))?.lastmod).toBe('2026-11-01')
  })

  it('leaves out a product that is off', () => {
    const urls = buildPortalSitemapUrls({
      origins: allOnPrimary(PRIMARY),
      sections: portalSitemapSections(null, allOnPrimary(PRIMARY)),
      ...content,
      flags: { feedback: false, changelog: true },
    })
    expect(urls.map((u) => u.loc)).toEqual([
      `${PRIMARY}/changelog`,
      `${PRIMARY}/changelog/changelog_1`,
    ])
  })
})
