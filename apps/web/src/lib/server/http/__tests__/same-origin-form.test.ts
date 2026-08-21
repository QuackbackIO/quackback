import { describe, expect, it } from 'vitest'
import { originMatchesRequestHost } from '../same-origin-form'

describe('originMatchesRequestHost', () => {
  it('accepts a browser https Origin against the public Host', () => {
    expect(
      originMatchesRequestHost('https://south63792f.quackback.co.uk', 'south63792f.quackback.co.uk')
    ).toBe(true)
  })

  it('accepts localhost http (self-host)', () => {
    expect(originMatchesRequestHost('http://localhost:3000', 'localhost:3000')).toBe(true)
  })

  it('refuses a missing Origin, a foreign Origin, and a suffix host', () => {
    expect(originMatchesRequestHost(null, 'south63792f.quackback.co.uk')).toBe(false)
    expect(originMatchesRequestHost('https://attacker.test', 'south63792f.quackback.co.uk')).toBe(
      false
    )
    expect(
      originMatchesRequestHost(
        'https://south63792f.quackback.co.uk.attacker.test',
        'south63792f.quackback.co.uk'
      )
    ).toBe(false)
  })

  it('uses the first forwarded host when a proxy lists several', () => {
    expect(
      originMatchesRequestHost(
        'https://south63792f.quackback.co.uk',
        'south63792f.quackback.co.uk, 127.0.0.1:3000'
      )
    ).toBe(true)
  })
})
