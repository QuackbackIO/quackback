/**
 * Where the portal starts and where the feed lives. With Home on, `/` is Home
 * and the feed is at `/feedback`. With Home off, `/` is the first page the
 * menu shows: the feed itself when that is Feedback, else a redirect to it.
 * The legacy theme keeps the feed at `/`.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign, type PortalDesign } from '../schema'
import {
  hasFeedSearch,
  portalFeedbackPath,
  portalLanding,
  portalSitemapPaths,
  type PortalPathSettings,
} from '../paths'

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function v2(edit: (doc: PortalDesign) => void = () => {}): PortalPathSettings {
  const doc = defaultDesign()
  edit(doc)
  return { engine: 'v2', nav: doc.nav }
}

describe('portalLanding', () => {
  it('keeps the feed at the root on the legacy theme', () => {
    expect(portalLanding({ engine: 'legacy' }, ALL_ON)).toEqual({ kind: 'feed' })
    expect(portalFeedbackPath({ engine: 'legacy' }, ALL_ON)).toBe('/')
  })

  it('starts on Home when it is on, with the feed at /feedback', () => {
    const settings = v2((doc) => (doc.nav.home.on = true))
    expect(portalLanding(settings, ALL_ON)).toEqual({ kind: 'home' })
    expect(portalFeedbackPath(settings, ALL_ON)).toBe('/feedback')
  })

  it('starts on the feed when Home is off and Feedback leads the menu', () => {
    expect(portalLanding(v2(), ALL_ON)).toEqual({ kind: 'feed' })
    expect(portalFeedbackPath(v2(), ALL_ON)).toBe('/')
  })

  it('sends the root to the first page the menu shows', () => {
    const settings = v2((doc) => {
      doc.nav.items = [
        { type: 'help', shown: true },
        { type: 'feedback', shown: true },
        { type: 'roadmap', shown: true },
      ]
    })
    expect(portalLanding(settings, ALL_ON)).toEqual({ kind: 'redirect', to: '/hc' })
    expect(portalFeedbackPath(settings, ALL_ON)).toBe('/feedback')
  })

  it('skips a page that is hidden or whose module is off', () => {
    const settings = v2((doc) => {
      doc.nav.items = [
        { type: 'feedback', shown: false },
        { type: 'help', shown: true },
        { type: 'changelog', shown: true },
      ]
    })
    expect(portalLanding(settings, { ...ALL_ON, help: false })).toEqual({
      kind: 'redirect',
      to: '/changelog',
    })
  })

  it('falls back to the feed when no page in the menu can be shown', () => {
    const settings = v2((doc) => (doc.nav.items = [{ type: 'status', shown: true }]))
    expect(portalLanding(settings, { ...ALL_ON, status: false })).toEqual({ kind: 'feed' })
  })
})

describe('portalSitemapPaths', () => {
  it('lists the root, then the feed at its one address', () => {
    expect(portalSitemapPaths({ engine: 'legacy' }, ALL_ON)).toEqual(['/', '/roadmap'])
    expect(
      portalSitemapPaths(
        v2((doc) => (doc.nav.home.on = true)),
        ALL_ON
      )
    ).toEqual(['/', '/feedback', '/roadmap'])
  })

  it('leaves out a root that only redirects', () => {
    const settings = v2((doc) => {
      doc.nav.items = [
        { type: 'help', shown: true },
        { type: 'feedback', shown: true },
      ]
    })
    expect(portalSitemapPaths(settings, ALL_ON)).toEqual(['/feedback', '/roadmap'])
  })

  it('lists no feed while Feedback is off', () => {
    expect(
      portalSitemapPaths({ engine: 'legacy' }, { ...ALL_ON, feedback: false, roadmap: false })
    ).toEqual([])
  })
})

describe('hasFeedSearch', () => {
  it('spots the feed’s own parameters, so an old link can follow the feed', () => {
    expect(hasFeedSearch({ board: 'bugs' })).toBe(true)
    expect(hasFeedSearch({ sort: 'top', status: ['open'] })).toBe(true)
    expect(hasFeedSearch({})).toBe(false)
    expect(hasFeedSearch({ utm_source: 'mail' })).toBe(false)
  })
})
