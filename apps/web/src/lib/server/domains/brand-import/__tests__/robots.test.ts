import { describe, expect, it } from 'vitest'
import { robotsAllows } from '../robots'

describe('robotsAllows', () => {
  it('follows the group for every agent when none names the reader', () => {
    const text = `User-agent: *\nDisallow: /private\n`
    expect(robotsAllows(text, '/')).toBe(true)
    expect(robotsAllows(text, '/private/page')).toBe(false)
  })

  it('follows a group that names the reader over the one for every agent', () => {
    const text = `User-agent: *\nAllow: /\n\nUser-agent: QuackbackBrandReader\nDisallow: /\n`
    expect(robotsAllows(text, '/')).toBe(false)
  })

  it('lets the longest rule win, and Allow win a tie', () => {
    const text = `User-agent: *\nDisallow: /\nAllow: /$\nAllow: /en/\n`
    expect(robotsAllows(text, '/')).toBe(true)
    expect(robotsAllows(text, '/en/pricing')).toBe(true)
    expect(robotsAllows(text, '/de/')).toBe(false)
  })

  it('reads wildcards and shared agent lines', () => {
    const text = `User-agent: GoodBot\nUser-agent: *\nDisallow: /*.pdf$\n`
    expect(robotsAllows(text, '/files/guide.pdf')).toBe(false)
    expect(robotsAllows(text, '/files/guide.pdf?x=1')).toBe(true)
  })

  it('allows everything an empty Disallow or no file covers', () => {
    expect(robotsAllows(`User-agent: *\nDisallow:\n`, '/')).toBe(true)
    expect(robotsAllows('', '/')).toBe(true)
  })
})
