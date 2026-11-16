import { describe, expect, it } from 'vitest'
import { allOnPrimary } from '../section-links'
import { teamPageHref } from '../team-page-href'

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
