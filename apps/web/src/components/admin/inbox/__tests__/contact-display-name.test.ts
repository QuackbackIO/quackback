import { describe, expect, it } from 'vitest'
import { supportContactName } from '../contact-display-name'

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
