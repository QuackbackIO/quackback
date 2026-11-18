import { describe, expect, it } from 'vitest'
import {
  effectiveSectionDomains,
  hostOfOrigin,
  portalSectionsEnabled,
  resolveSectionHostRoute,
  sectionForPath,
  sectionHomeForHost,
  sectionOfHost,
  storedSectionDomains,
  withoutPrimaryHost,
  type SectionDomain,
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
    for (const path of ['/api/health', '/auth/login', '/settings', '/robots.txt']) {
      expect(route('help.acme.com', path)).toEqual({ kind: 'pass' })
    }
  })

  it.each([
    ['/admin', ''],
    ['/admin/feedback', '?post=p_1&view=all'],
    ['/admin/login', '?callbackUrl=%2Fadmin'],
    ['/onboarding', ''],
    ['/onboarding/account', '?step=2'],
    ['/apps/zendesk/sidebar', '?origin=x'],
    ['/device', '?user_code=ABCD-EFGH'],
    ['/oauth/consent', '?client_id=c1'],
    ['/oauth/slack/connect', ''],
  ])(
    'sends the team page %s%s to the primary domain, without carrying the session',
    (path, search) => {
      expect(route('help.acme.com', path, { search })).toEqual({
        kind: 'redirect',
        status: 302,
        location: `${PRIMARY}${path}${search}`,
        carrySession: false,
      })
    }
  )

  it('sends team pages to the primary domain from a host set up but not yet verified', () => {
    expect(route('news.acme.com', '/admin')).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/admin`,
      carrySession: false,
    })
  })

  it('sends team pages to the primary domain while its section is off', () => {
    expect(route('help.acme.com', '/admin', { sectionEnabled: { help: false } })).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/admin`,
      carrySession: false,
    })
  })

  it('does not take a team prefix that only starts the same way', () => {
    expect(route('help.acme.com', '/administer')).not.toMatchObject({ carrySession: false })
    expect(route('help.acme.com', '/devices')).not.toMatchObject({ carrySession: false })
  })

  it('never redirects a team request that changes something', () => {
    expect(route('help.acme.com', '/admin', { method: 'POST' })).toEqual({ kind: 'pass' })
  })

  it('never redirects a team page to itself when a section names the primary host', () => {
    const map: SectionDomainMap = {
      help: { hostname: 'acme.example.com', verifiedAt: VERIFIED },
    }
    expect(route('acme.example.com', '/admin', { map })).toEqual({ kind: 'pass' })
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

describe('team sign-in while a section owns /', () => {
  // Feedback owns `/`. The team's sign-in is the dialog on `/` with a team
  // callback; moved to the section host, it signed in with portal scope and
  // went back to the primary domain without a session, round and round.
  const OWNS_ROOT: SectionDomainMap = {
    ...MAP,
    feedback: { hostname: 'feedback.acme.com', verifiedAt: VERIFIED },
  }
  const signIn = (callbackUrl: string, auth = 'signin') =>
    `?${new URLSearchParams({ auth, callbackUrl }).toString()}`

  it('moves the portal home to the section host as before', () => {
    expect(route('acme.example.com', '/', { map: OWNS_ROOT })).toEqual({
      kind: 'redirect',
      status: 301,
      location: 'https://feedback.acme.com/',
    })
  })

  it.each([
    '/admin',
    '/admin/feedback?post=p_1',
    '/onboarding',
    '/onboarding/account?step=2',
    '/apps/zendesk/sidebar',
    '/device?user_code=ABCD-EFGH',
    '/oauth/consent?client_id=c1',
    '/complete-signup/inv_1',
  ])('keeps the sign-in for %s on the primary domain', (callbackUrl) => {
    for (const auth of ['signin', 'signup']) {
      expect(
        route('acme.example.com', '/', { map: OWNS_ROOT, search: signIn(callbackUrl, auth) })
      ).toEqual({ kind: 'pass' })
    }
  })

  it('sends a team sign-in that reached the section host back to the primary domain', () => {
    const search = signIn('/admin')
    expect(route('feedback.acme.com', '/', { map: OWNS_ROOT, search })).toEqual({
      kind: 'redirect',
      status: 302,
      location: `${PRIMARY}/${search}`,
      carrySession: false,
    })
  })

  it('still moves a portal sign-in, which belongs on the section host', () => {
    for (const callbackUrl of ['/', '/b/ideas', '/roadmap', '/administrator', '//evil.com/admin']) {
      const search = signIn(callbackUrl)
      expect(route('acme.example.com', '/', { map: OWNS_ROOT, search })).toEqual({
        kind: 'redirect',
        status: 301,
        location: `https://feedback.acme.com/${search}`,
      })
    }
  })

  it('moves the home when a team callback comes without a sign-in request', () => {
    const search = `?${new URLSearchParams({ callbackUrl: '/admin' }).toString()}`
    expect(route('acme.example.com', '/', { map: OWNS_ROOT, search })).toEqual({
      kind: 'redirect',
      status: 301,
      location: `https://feedback.acme.com/${search}`,
    })
  })

  it('shows the portal sign-in on the section host as before', () => {
    const search = signIn('/b/ideas')
    expect(route('feedback.acme.com', '/', { map: OWNS_ROOT, search })).toEqual({ kind: 'pass' })
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
    for (const path of [
      '/changelog/feed',
      '/status/feed',
      '/api/health',
      '/admin',
      '/onboarding',
      '/apps/zendesk/sidebar',
      '/device',
      '/oauth/consent',
    ]) {
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
        primaryHost: null,
      })
    ).toEqual({ status: { hostname: 'status.acme.com', verifiedAt: null } })
  })

  it("falls back to the help center's own domain before the map is first written", () => {
    expect(
      effectiveSectionDomains({
        sectionDomains: undefined,
        legacyHelpDomain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
        primaryHost: null,
      })
    ).toEqual({ help: { hostname: 'help.acme.com', verifiedAt: VERIFIED } })
  })

  it('is empty with neither', () => {
    expect(
      effectiveSectionDomains({
        sectionDomains: undefined,
        legacyHelpDomain: { domain: null, verifiedAt: null },
        primaryHost: null,
      })
    ).toEqual({})
    expect(
      effectiveSectionDomains({
        sectionDomains: undefined,
        legacyHelpDomain: null,
        primaryHost: null,
      })
    ).toEqual({})
  })

  it('treats a stored empty map as written, so a cleared help domain stays cleared', () => {
    expect(
      effectiveSectionDomains({
        sectionDomains: {},
        legacyHelpDomain: { domain: 'help.acme.com', verifiedAt: VERIFIED },
        primaryHost: null,
      })
    ).toEqual({})
  })
})

describe('a section hostname that is the primary domain', () => {
  const LEGACY_ON_PRIMARY = { domain: 'acme.example.com', verifiedAt: VERIFIED }

  it('is left out of the map every reader takes, without case, port or trailing dot', () => {
    for (const primaryHost of ['acme.example.com', 'ACME.example.com:8443', 'acme.example.com.']) {
      expect(
        effectiveSectionDomains({
          sectionDomains: {
            help: { hostname: 'acme.example.com', verifiedAt: VERIFIED },
            status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
          },
          legacyHelpDomain: null,
          primaryHost,
        })
      ).toEqual({ status: { hostname: 'status.acme.com', verifiedAt: VERIFIED } })
    }
  })

  it("is left out when it is the help center's own domain from before the map", () => {
    expect(
      effectiveSectionDomains({
        sectionDomains: undefined,
        legacyHelpDomain: LEGACY_ON_PRIMARY,
        primaryHost: 'acme.example.com',
      })
    ).toEqual({})
  })

  it('is kept in the map a write starts from', () => {
    expect(
      storedSectionDomains({ sectionDomains: undefined, legacyHelpDomain: LEGACY_ON_PRIMARY })
    ).toEqual({ help: { hostname: 'acme.example.com', verifiedAt: VERIFIED } })
  })

  it('leaves the map as it is with no primary host to compare', () => {
    const map = { help: { hostname: 'acme.example.com', verifiedAt: VERIFIED } }
    expect(withoutPrimaryHost(map, null)).toBe(map)
  })

  it('takes the host from an origin, and nothing from something that is not one', () => {
    expect(hostOfOrigin('https://Acme.example.com:8443/')).toBe('acme.example.com')
    expect(hostOfOrigin('not a url')).toBeNull()
    expect(hostOfOrigin(undefined)).toBeNull()
  })

  it('routes the primary domain as the primary domain, even with the raw map', () => {
    const map: SectionDomainMap = {
      help: { hostname: 'acme.example.com', verifiedAt: VERIFIED },
      status: { hostname: 'status.acme.com', verifiedAt: VERIFIED },
    }
    expect(route('acme.example.com', '/', { map })).toEqual({ kind: 'pass' })
    expect(route('acme.example.com', '/roadmap', { map })).toEqual({ kind: 'pass' })
    expect(route('acme.example.com', '/hc', { map })).toEqual({ kind: 'pass' })
    expect(route('acme.example.com', '/status', { map })).toEqual({
      kind: 'redirect',
      status: 301,
      location: 'https://status.acme.com/status',
    })
  })
})

describe('no route ever redirects to its own URL', () => {
  // Every map over a small set of hosts, for every primary among them: no
  // request is ever sent to the URL it asked for. The maps include ones no
  // write would make (one hostname under two sections, the primary's own
  // hostname), since a reader can still meet them in stored data.
  const HOSTS = ['acme.example.com', 'help.acme.com', 'status.acme.com']
  const SECTIONS: PortalSection[] = ['feedback', 'help', 'status']
  const PATHS = ['/', '/b/x', '/roadmap', '/changelog', '/hc', '/status', '/support', '/admin']
  const CHOICES: (SectionDomain | null)[] = [
    null,
    ...HOSTS.flatMap((hostname) => [
      { hostname, verifiedAt: VERIFIED },
      { hostname, verifiedAt: null },
    ]),
  ]

  function* maps(index = 0, map: SectionDomainMap = {}): Generator<SectionDomainMap> {
    if (index === SECTIONS.length) {
      yield map
      return
    }
    for (const entry of CHOICES) {
      const next = { ...map }
      if (entry) next[SECTIONS[index]] = entry
      yield* maps(index + 1, next)
    }
  }

  it('holds for every map, primary, host, path and section switch', () => {
    let checked = 0
    for (const map of maps()) {
      for (const primary of HOSTS) {
        for (const host of HOSTS) {
          for (const path of [...PATHS, '/?auth=signin&callbackUrl=%2Fadmin']) {
            const [pathname, query = ''] = path.split('?')
            for (const enabled of [ALL_ON, { ...ALL_ON, help: false }]) {
              const search = query ? `?${query}` : ''
              const result = resolveSectionHostRoute({
                host,
                path: pathname,
                search,
                method: 'GET',
                map,
                sectionEnabled: enabled,
                primaryOrigin: `https://${primary}`,
              })
              checked += 1
              if (result.kind !== 'redirect') continue
              expect(result.location).not.toBe(`https://${host}${pathname}${search}`)
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000)
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
