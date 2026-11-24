import { describe, expect, it } from 'vitest'
import { supportContactName, supportTeamName } from '../support-contact-name'

describe('supportContactName', () => {
  it('shows the account name when the public name is a generic anonymous label', () => {
    expect(
      supportContactName({
        accountName: 'Ada Lovelace',
        publicName: 'Quiet Otter',
        fallback: 'Visitor',
      })
    ).toBe('Ada Lovelace')
  })

  it('shows the account name when the public name is blank', () => {
    expect(
      supportContactName({
        accountName: 'Ada Lovelace',
        publicName: '  ',
        fallback: 'Visitor',
      })
    ).toBe('Ada Lovelace')
  })

  it('keeps the public name when the account still has the stock anonymous label', () => {
    expect(
      supportContactName({
        accountName: 'Anonymous',
        publicName: 'Quiet Otter',
        fallback: 'Visitor',
      })
    ).toBe('Quiet Otter')
  })

  it('shows the stock anonymous label when there is no public name', () => {
    expect(
      supportContactName({
        accountName: 'Anonymous',
        publicName: null,
        fallback: 'Visitor',
      })
    ).toBe('Anonymous')
  })

  it('falls back when neither name is present', () => {
    expect(supportContactName({ accountName: null, publicName: '', fallback: 'Visitor' })).toBe(
      'Visitor'
    )
  })
})

describe('supportTeamName', () => {
  it('takes the messenger team name, else the workspace name', () => {
    expect(supportTeamName('Acme Help', 'Acme')).toBe('Acme Help')
    expect(supportTeamName('  ', 'Acme')).toBe('Acme')
    expect(supportTeamName(undefined, 'Acme')).toBe('Acme')
    expect(supportTeamName(null, ' ')).toBeNull()
  })
})
