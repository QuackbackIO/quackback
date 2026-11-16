import { describe, expect, it } from 'vitest'
import {
  allOnPrimary,
  compactSectionLinks,
  expandSectionLinks,
  pageCanonical,
  portalPageUrl,
  sectionOrigins,
  sectionServedAt,
  sectionUrl,
  sectionsOnPrimary,
  teamPageHref,
  type SectionOrigins,
} from '../section-links'
import type { SectionDomainMap } from '../section-domains'
import type { PortalSection } from '../custom-domains'

const PRIMARY = 'https://acme.example.com'
const VERIFIED = '2026-11-01T00:00:00.000Z'

const ALL_ON: Record<PortalSection, boolean> = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const MAP: SectionDomainMap = {
  help: { hostname: 'help.acme.com', verifiedAt: VERIFIED },
  status: { hostname: 'Status.Acme.com.', verifiedAt: VERIFIED },
  // Set up but not yet verified: links stay on the primary domain.
  changelog: { hostname: 'news.acme.com', verifiedAt: null },
}

function origins(
  opts: { map?: SectionDomainMap; off?: PortalSection[]; primary?: string } = {}
): SectionOrigins {
  const sectionEnabled = { ...ALL_ON }
  for (const section of opts.off ?? []) sectionEnabled[section] = false
  return sectionOrigins({
    map: opts.map ?? MAP,
    sectionEnabled,
    primaryOrigin: opts.primary ?? PRIMARY,
  })
}

describe('sectionOrigins', () => {
  it("gives a verified section that is on its own host's origin", () => {
    expect(origins().help).toBe('https://help.acme.com')
  })

  it('writes the host as routing compares it: lower case, no trailing dot', () => {
    expect(origins().status).toBe('https://status.acme.com')
  })

  it('keeps a section whose host is not verified on the primary domain', () => {
    expect(origins().changelog).toBe(PRIMARY)
  })

  it('keeps a section without a host on the primary domain', () => {
    expect(origins().feedback).toBe(PRIMARY)
    expect(origins().roadmap).toBe(PRIMARY)
    expect(origins().support).toBe(PRIMARY)
  })

  it('keeps a section that is off on the primary domain, where its host sends visitors', () => {
    expect(origins({ off: ['help'] }).help).toBe(PRIMARY)
  })

  it('names the primary origin without a trailing slash', () => {
    const result = origins({ primary: 'https://acme.example.com/' })
    expect(result.primary).toBe(PRIMARY)
    expect(result.feedback).toBe(PRIMARY)
  })
})

describe('sectionUrl', () => {
  it("joins a section's path to its own host", () => {
    expect(sectionUrl('help', '/hc/articles/x', origins())).toBe(
      'https://help.acme.com/hc/articles/x'
    )
  })

  it('joins a path to the primary domain for a section without a host', () => {
    expect(sectionUrl('feedback', '/b/ideas/posts/p1', origins())).toBe(
      'https://acme.example.com/b/ideas/posts/p1'
    )
  })

  it("writes a section's home as / on its own host, as the router does", () => {
    expect(sectionUrl('help', '/hc', origins())).toBe('https://help.acme.com/')
    expect(sectionUrl('status', '/status', origins())).toBe('https://status.acme.com/')
  })

  it("keeps a section's home path on the primary domain", () => {
    expect(sectionUrl('changelog', '/changelog', origins())).toBe(
      'https://acme.example.com/changelog'
    )
    expect(sectionUrl('feedback', '/', origins())).toBe('https://acme.example.com/')
  })

  it('adds the leading slash a path left out', () => {
    expect(sectionUrl('status', 'status/inc_1', origins())).toBe(
      'https://status.acme.com/status/inc_1'
    )
  })
})

describe('portalPageUrl', () => {
  it("finds a page's section from its path", () => {
    expect(portalPageUrl('/status/inc_1', origins())).toBe('https://status.acme.com/status/inc_1')
    expect(portalPageUrl('/hc', origins())).toBe('https://help.acme.com/')
  })

  it('keeps a path every host shares on the primary domain', () => {
    expect(portalPageUrl('/settings/preferences', origins())).toBe(
      'https://acme.example.com/settings/preferences'
    )
    expect(portalPageUrl('/changelog/feed', origins({ map: { changelog: MAP.help! } }))).toBe(
      'https://acme.example.com/changelog/feed'
    )
  })
})

describe('allOnPrimary', () => {
  it('puts every section on the primary domain', () => {
    const result = allOnPrimary('https://acme.example.com/')
    expect(result.primary).toBe(PRIMARY)
    expect(result.help).toBe(PRIMARY)
    expect(result.status).toBe(PRIMARY)
  })
})

describe('sectionsOnPrimary', () => {
  it('lists the sections the primary domain serves itself', () => {
    expect(sectionsOnPrimary(origins())).toEqual(['feedback', 'roadmap', 'changelog', 'support'])
  })
})

describe('sectionServedAt', () => {
  it('names the section a host is linked for', () => {
    expect(sectionServedAt('help.acme.com', origins())).toBe('help')
    expect(sectionServedAt('STATUS.acme.com:443', origins())).toBe('status')
  })

  it('names none for the primary domain or a host not in use', () => {
    expect(sectionServedAt('acme.example.com', origins())).toBeNull()
    // Mapped but not verified: the host is not linked, so it serves nothing of its own.
    expect(sectionServedAt('news.acme.com', origins())).toBeNull()
    expect(sectionServedAt(null, origins())).toBeNull()
  })
})

describe('pageCanonical', () => {
  it("builds a page's canonical URL on its section's origin", () => {
    // On the help center's host, whose base URL is that host.
    const context = {
      baseUrl: 'https://help.acme.com',
      sectionLinks: compactSectionLinks({
        origins: origins(),
        hostOrigin: 'https://help.acme.com',
        baseUrl: 'https://help.acme.com',
      }),
    }
    expect(pageCanonical('feedback', '/b/ideas/posts/p1', context)).toBe(
      'https://acme.example.com/b/ideas/posts/p1'
    )
    expect(pageCanonical('status', '/status', context)).toBe('https://status.acme.com/')
  })

  it('builds it on the base URL when no section has its own host, and is empty without one', () => {
    expect(pageCanonical('changelog', '/changelog', { baseUrl: PRIMARY })).toBe(
      'https://acme.example.com/changelog'
    )
    expect(pageCanonical('changelog', '/changelog', {})).toBe('')
  })
})

describe('compactSectionLinks and expandSectionLinks', () => {
  const onPrimary = allOnPrimary(PRIMARY)

  it('sends nothing at all while no section has its own host and the page is on the primary', () => {
    expect(
      compactSectionLinks({ origins: onPrimary, hostOrigin: PRIMARY, baseUrl: PRIMARY })
    ).toBeUndefined()
    expect(expandSectionLinks(PRIMARY, undefined)).toEqual({
      origins: onPrimary,
      hostOrigin: PRIMARY,
    })
  })

  it('sends only the sections on their own host, and rebuilds the full table from them', () => {
    const compact = compactSectionLinks({
      origins: origins(),
      hostOrigin: PRIMARY,
      baseUrl: PRIMARY,
    })
    expect(compact).toEqual({
      hosts: { help: 'https://help.acme.com', status: 'https://status.acme.com' },
    })
    expect(expandSectionLinks(PRIMARY, compact)).toEqual({
      origins: origins(),
      hostOrigin: PRIMARY,
    })
  })

  it("names the page's own host and the primary origin when the page is on a section host", () => {
    // The base URL on the help center's host is that host, not the primary.
    const here = 'https://help.acme.com'
    const compact = compactSectionLinks({ origins: origins(), hostOrigin: here, baseUrl: here })
    expect(compact).toEqual({
      hosts: { help: 'https://help.acme.com', status: 'https://status.acme.com' },
      here,
      primary: PRIMARY,
    })
    expect(expandSectionLinks(here, compact)).toEqual({ origins: origins(), hostOrigin: here })
  })

  it('knows nothing without a base URL', () => {
    expect(expandSectionLinks(undefined, undefined)).toBeNull()
  })
})

describe('teamPageHref', () => {
  const origins = {
    ...allOnPrimary('https://acme.com'),
    help: 'https://help.acme.com',
  }

  it('links a team page on a section host to the primary domain', () => {
    expect(teamPageHref('/admin', { origins, hostOrigin: 'https://help.acme.com' })).toBe(
      'https://acme.com/admin'
    )
    expect(
      teamPageHref('/admin/feedback/moderation', { origins, hostOrigin: 'https://help.acme.com' })
    ).toBe('https://acme.com/admin/feedback/moderation')
  })

  it('is null on the primary domain, where the plain link stays on the page', () => {
    expect(teamPageHref('/admin', { origins, hostOrigin: 'https://acme.com' })).toBeNull()
  })

  it('is null without the table', () => {
    expect(teamPageHref('/admin', null)).toBeNull()
  })
})
