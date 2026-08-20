import { describe, expect, it } from 'vitest'
import { isCanonicalIdentityHost } from '@/lib/server/functions/origin-transfer'

describe('origin transfer host binding', () => {
  it('accepts only the projected canonical hostname', () => {
    expect(isCanonicalIdentityHost('new.quackback.co.uk', 'https://new.quackback.co.uk')).toBe(true)
    expect(isCanonicalIdentityHost('new.quackback.co.uk:443', 'https://new.quackback.co.uk')).toBe(
      true
    )
    expect(isCanonicalIdentityHost('old.quackback.co.uk', 'https://new.quackback.co.uk')).toBe(
      false
    )
    expect(isCanonicalIdentityHost(null, 'https://new.quackback.co.uk')).toBe(false)
  })
})
