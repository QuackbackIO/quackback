import { describe, expect, it } from 'vitest'
import {
  effectiveSectionDomains,
  portalSectionsEnabled,
  resolveSectionHostRoute,
  sectionForPath,
  sectionHomeForHost,
  sectionOfHost,
  type SectionDomainMap,
  type SectionHostRoute,
} from '../section-domains'
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
  status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
  // Set up but not yet verified: nothing is sent there.
  changelog: { hostname: 'news.acme.com', verifiedAt: null },
}

function route(
  host: string,
  path: string,
  opts: {
    search?: string
    method?: string
    map?: SectionDomainMap
    sectionEnabled?: Partial<Record<PortalSection, boolean>>
  } = {}
): SectionHostRoute {
  return resolveSectionHostRoute({
    host,
    path,
    search: opts.search ?? '',
    method: opts.method ?? 'GET',
    map: opts.map ?? MAP,
    sectionEnabled: { ...ALL_ON, ...opts.sectionEnabled },
    primaryOrigin: PRIMARY,
  })
}

describe('sectionForPath', () => {
  it.each<[string, PortalSection]>([
    ['/', 'feedback'],
    ['/b/bugs', 'feedback'],
    ['/b/bugs/posts/p1', 'feedback'],
    ['/roadmap', 'roadmap'],
    ['/roadmap/', 'roadmap'],
    ['/changelog', 'changelog'],
    ['/changelog/entry_1', 'changelog'],
    ['/hc', 'help'],
    ['/hc/articles/x', 'help'],
    ['/hc/sitemap.xml', 'help'],
    ['/help', 'help'],
    ['/support', 'support'],
    ['/support/conv_1', 'support'],
    ['/status', 'status'],
    ['/status/inc_1', 'status'],
  ])('%s belongs to %s', (path, section) => {
    expect(sectionForPath(path)).toBe(section)
  })

  it.each([
    '/api/health',
    '/api/storage/files/a.png',
    '/auth/login',
    '/verify-magic-link',
    '/oauth/consent',
    '/.well-known/openid-configuration',
    '/widget',
    '/widget/frame',
    '/unsubscribe',
    '/portal-invite/inv_1',
    '/complete-signup/x',
    '/csat',
    '/device',
    '/settings',
    '/settings/profile',
    '/notifications',
    '/u/principal_1',
    '/robots.txt',
    '/sitemap.xml',
    '/changelog/feed',
    '/changelog/rss',
    '/changelog/rss.xml',
    '/status/feed',
    '/admin',
    '/admin/settings/domains',
    '/onboarding',
    '/apps',
    '/assets/main-abc.js',
    '/favicon.ico',
    '/_serverFn/abc',
  ])('%s is shared by every host', (path) => {
    expect(sectionForPath(path)).toBeNull()
  })

  it('does not take a prefix that only starts the same way', () => {
    expect(sectionForPath('/hcx')).toBeNull()
    expect(sectionForPath('/statuses')).toBeNull()
    expect(sectionForPath('/supporting')).toBeNull()
    expect(sectionForPath('/bx')).toBeNull()
  })
})

describe('sectionOfHost', () => {
  it('finds the section a hostname is mapped to, verified or not', () => {
    expect(sectionOfHost('help.acme.com', MAP)).toBe('help')
    expect(sectionOfHost('news.acme.com', MAP)).toBe('changelog')
  })

  it('compares without case, port or trailing dot', () => {
    expect(sectionOfHost('HELP.acme.com.', MAP)).toBe('help')
    expect(sectionOfHost('help.acme.com:443', MAP)).toBe('help')
  })

  it('is null for a host no section uses', () => {
    expect(sectionOfHost('acme.example.com', MAP)).toBeNull()
    expect(sectionOfHost(null, MAP)).toBeNull()
  })
})

describe('resolveSectionHostRoute on a section host', () => {
  it("shows the section's home at /", () => {
    expect(route('help.acme.com', '/')).toEqual({ kind: 'rewrite-home', home: '/hc' })
    expect(route('status.acme.com', '/')).toEqual({ kind: 'rewrite-home', home: '/status' })
  })

  it('keeps the section prefix on deeper paths', () => {
    expect(route('help.acme.com', '/hc')).toEqual({ kind: 'pass' })
    expect(route('help.acme.com', '/hc/articles/x')).toEqual({ kind: 'pass' })
    expect(route('status.acme.com', '/status/inc_1')).toEqual({ kind: 'pass' })
  })

  it('serves the shared paths', () => {
    for (const path of ['/api/health', '/auth/login', '/admin', '/settings', '/robots.txt']) {
      expect(route('help.acme.com', path)).toEqual({ kind: 'pass' })
    }
  })

  it("sends another section's path to that section's host when it has a verified one", () => {
    expect(route('help.acme.com', '/status/inc_1', { search: '?a=1' })).toEqual({
      kind: 'redirect',
      status: 302,
      location: 'https://status.acme.com/status/inc_1?a=1',
    })
  })

  it("sends another section's path to the primary domain when that section has no host", () => {
    expect(route('help.acme.com', '/roadmap')).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/roadmap`,
    })
    expect(route('help.acme.com', '/b/bugs')).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/b/bugs`,
    })
  })

  it("sends another section's path to the primary domain when its host is not verified", () => {
    expect(route('help.acme.com', '/changelog')).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/changelog`,
    })
  })

  it("sends another section's path to the primary domain when that section is off", () => {
    expect(route('help.acme.com', '/status', { sectionEnabled: { status: false } })).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/status`,
    })
  })

  it('serves its own pages on a host set up but not yet verified', () => {
    expect(route('news.acme.com', '/')).toEqual({ kind: 'rewrite-home', home: '/changelog' })
    expect(route('news.acme.com', '/changelog/e1')).toEqual({ kind: 'pass' })
  })

  it('sends everything but the shared paths to the primary domain while its section is off', () => {
    const off = { sectionEnabled: { help: false } }
    expect(route('help.acme.com', '/', off)).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/`,
    })
    expect(route('help.acme.com', '/hc/articles/x', { ...off, search: '?q=1' })).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/hc/articles/x?q=1`,
    })
    expect(route('help.acme.com', '/api/health', off)).toEqual({ kind: 'pass' })
  })

  it('needs no rewrite on a feedback host, whose home is already /', () => {
    const map: SectionDomainMap = {
      feedback: { hostname: 'ideas.acme.com', verifiedAt: VERIFIED },
    }
    expect(route('ideas.acme.com', '/', { map })).toEqual({ kind: 'pass' })
    expect(route('ideas.acme.com', '/b/bugs', { map })).toEqual({ kind: 'pass' })
    expect(route('ideas.acme.com', '/hc', { map })).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/hc`,
    })
  })

  it('matches the host without case or port', () => {
    expect(route('Help.Acme.com:443', '/')).toEqual({ kind: 'rewrite-home', home: '/hc' })
  })

  it('never redirects a request that changes something', () => {
    expect(route('help.acme.com', '/status', { method: 'POST' })).toEqual({ kind: 'pass' })
  })
})

describe('resolveSectionHostRoute on the primary host', () => {
  it("moves a mapped, verified section's paths to its host for good", () => {
    expect(route('acme.example.com', '/hc/articles/x', { search: '?ref=1' })).toEqual({
      kind: 'redirect',
      status: 301,
      location: 'https://help.acme.com/hc/articles/x?ref=1',
    })
    expect(route('acme.example.com', '/hc/sitemap.xml')).toEqual({
      kind: 'redirect',
      status: 301,
      location: 'https://help.acme.com/hc/sitemap.xml',
    })
    expect(route('acme.example.com', '/status')).toEqual({
      kind: 'redirect',
      status: 301,
      location: 'https://status.acme.com/status',
    })
  })

  it('keeps sections without a verified host', () => {
    expect(route('acme.example.com', '/')).toEqual({ kind: 'pass' })
    expect(route('acme.example.com', '/roadmap')).toEqual({ kind: 'pass' })
    expect(route('acme.example.com', '/changelog')).toEqual({ kind: 'pass' })
  })

  it('keeps a section that is off, so its host is not sent visitors', () => {
    expect(route('acme.example.com', '/hc', { sectionEnabled: { help: false } })).toEqual({
      kind: 'pass',
    })
  })

  it('keeps the shared paths, feeds included', () => {
    const map: SectionDomainMap = {
      ...MAP,
      changelog: { hostname: 'news.acme.com', verifiedAt: VERIFIED },
    }
    for (const path of ['/changelog/feed', '/status/feed', '/api/health', '/admin']) {
      expect(route('acme.example.com', path, { map })).toEqual({ kind: 'pass' })
    }
  })

  it('passes everything when no section has a host', () => {
    expect(route('acme.example.com', '/hc', { map: {} })).toEqual({ kind: 'pass' })
  })

  it('never redirects a request that changes something', () => {
    expect(route('acme.example.com', '/hc', { method: 'POST' })).toEqual({ kind: 'pass' })
  })

  it('does not redirect when the host is unknown', () => {
    expect(
      resolveSectionHostRoute({
        host: null,
        path: '/hc',
        search: '',
        method: 'GET',
        map: MAP,
        sectionEnabled: ALL_ON,
        primaryOrigin: PRIMARY,
      })
    ).toEqual({ kind: 'pass' })
  })
})

describe('effectiveSectionDomains', () => {
  it('reads the map when one is stored', () => {
    expect(
      effectiveSectionDomains({
        sectionDomains: { status: { hostname: 'status.acme.com', verifiedAt: null } },
        legacyHelpDomain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
      })
    ).toEqual({ status: { hostname: 'status.acme.com', verifiedAt: null } })
  })

  it("falls back to the help center's own domain before the map is first written", () => {
    expect(
      effectiveSectionDomains({
        sectionDomains: undefined,
        legacyHelpDomain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
      })
    ).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
  })

  it('is empty with neither', () => {
    expect(
      effectiveSectionDomains({
        sectionDomains: undefined,
        legacyHelpDomain: { domain: null, verifiedAt: null },
      })
    ).toEqual({})
    expect(effectiveSectionDomains({ sectionDomains: undefined, legacyHelpDomain: null })).toEqual(
      {}
    )
  })

  it('treats a stored empty map as written, so a cleared help domain stays cleared', () => {
    expect(
      effectiveSectionDomains({
        sectionDomains: {},
        legacyHelpDomain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
      })
    ).toEqual({})
  })
})

describe('portalSectionsEnabled', () => {
  it('reads each section from its product switch', () => {
    expect(
      portalSectionsEnabled({
        featureFlags: {
          feedback: true,
          changelog: false,
          helpCenter: true,
          statusPage: true,
          supportTickets: false,
          supportInbox: false,
        },
        statusConfig: { enabled: false },
        portalConfig: { support: { enabled: true } },
      })
    ).toEqual({
      feedback: true,
      roadmap: true,
      changelog: false,
      help: true,
      support: false,
      status: false,
    })
  })
})

describe('sectionHomeForHost', () => {
  it("is the section's home on its host", () => {
    expect(sectionHomeForHost({ host: 'help.acme.com', map: MAP, sectionEnabled: ALL_ON })).toBe(
      '/hc'
    )
  })

  it('is null on any other host, on a feedback host, and while the section is off', () => {
    expect(
      sectionHomeForHost({ host: 'acme.example.com', map: MAP, sectionEnabled: ALL_ON })
    ).toBeNull()
    expect(
      sectionHomeForHost({
        host: 'ideas.acme.com',
        map: { feedback: { hostname: 'ideas.acme.com', verifiedAt: VERIFIED } },
        sectionEnabled: ALL_ON,
      })
    ).toBeNull()
    expect(
      sectionHomeForHost({
        host: 'help.acme.com',
        map: MAP,
        sectionEnabled: { ...ALL_ON, help: false },
      })
    ).toBeNull()
  })
})
