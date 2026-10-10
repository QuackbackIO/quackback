import { describe, expect, it } from 'vitest'
import { rssAlternateLink } from '../rss-alternate'

describe('rssAlternateLink', () => {
  it('offers the status feed on the status page and an incident page', () => {
    for (const leaf of ['/_portal/status/', '/_portal/status/$incidentId']) {
      expect(rssAlternateLink(['__root__', '/_portal', leaf])).toMatchObject({
        rel: 'alternate',
        type: 'application/rss+xml',
        href: '/status/feed',
      })
    }
  })

  it('keeps offering the changelog feed everywhere else', () => {
    for (const leaf of ['/_portal/', '/_portal/changelog/', '/admin/status']) {
      expect(rssAlternateLink(['__root__', leaf]).href).toBe('/changelog/feed')
    }
  })
})
