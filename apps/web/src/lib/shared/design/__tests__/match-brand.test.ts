/**
 * Matching a brand from screenshots in Ask AI: a message with images that
 * asks to match the brand, or has no other words, starts a brand. Each image
 * is checked for a pop-up's dimming layer or a cookie banner before it is
 * sent; a warned one holds the message until it is replaced or kept anyway.
 */
import { describe, expect, it } from 'vitest'
import {
  isBrandStart,
  isSiteStart,
  websiteIn,
  logoTitle,
  readAsWordmark,
  shotWarnings,
  titleToSet,
} from '../match-brand'

describe('a message that starts a brand', () => {
  it('has images and asks to match the brand, or says nothing else', () => {
    expect(isBrandStart('match my brand', 2)).toBe(true)
    expect(isBrandStart('Make it look like our site', 1)).toBe(true)
    expect(isBrandStart('use these screenshots', 1)).toBe(true)
    expect(isBrandStart('', 1)).toBe(true)
  })

  it('is not a request about something else, nor words with no images', () => {
    expect(isBrandStart('make the buttons rounder like this', 1)).toBe(false)
    expect(isBrandStart('match my brand', 0)).toBe(false)
  })
})

describe('a warning on an image', () => {
  const shots = [{ dimmed: false }, { dimmed: true }, { dimmed: false }]

  it('says an image is dimmed, measured or read, or that a banner covers it', () => {
    const read = { banners: [{ image: 2, box: { x: 0, y: 0.8, w: 1, h: 0.2 } }], dimmed: [0] }
    expect(shotWarnings(shots, read, new Set())).toEqual(['dimmed', 'dimmed', 'banner'])
  })

  it('lets a person keep an image anyway', () => {
    expect(shotWarnings(shots, null, new Set([1]))).toEqual([null, null, null])
  })
})

describe('the title a brand start sets', () => {
  it('is the name read, unless it is only the workspace’s own name in another case', () => {
    expect(titleToSet('Harbor Help', 'Harbor')).toBe('Harbor Help')
    expect(titleToSet('paylane', 'Paylane')).toBeNull()
    expect(titleToSet('  ', 'Paylane')).toBeNull()
  })

  it('is never one letter: a mark drawn as a letter is not a name', () => {
    expect(titleToSet('P', 'Acme')).toBeNull()
    expect(titleToSet(' p. ', 'Acme')).toBeNull()
  })
})

describe('the title beside a logo cut as a mark', () => {
  it('is the words in the logo when they are a name', () => {
    expect(logoTitle('Petalpost', 'Petalpost', 'Acme')).toBe('Petalpost')
    expect(logoTitle('Harbor Help', 'Harbor', 'Acme')).toBe('Harbor Help')
  })

  it('takes the brand name read from the screenshot over a letter read from the mark', () => {
    expect(logoTitle('P', 'Petalpost', 'Acme')).toBe('Petalpost')
    expect(logoTitle('Pp', 'Petalpost', 'Acme')).toBe('Petalpost')
  })

  it('falls back to the workspace name (no title) where no name was read', () => {
    expect(logoTitle('P', '', 'Acme')).toBeNull()
    expect(logoTitle('', null, 'Acme')).toBeNull()
    expect(logoTitle('V', 'V', 'Voltline')).toBeNull()
  })

  it('sets none where the name is the workspace’s own', () => {
    expect(logoTitle('P', 'petalpost', 'Petalpost')).toBeNull()
  })
})

describe('a logo read as a wordmark', () => {
  it('is the name set as a logo, or a mark much wider than tall', () => {
    expect(readAsWordmark({ wordmark: true, width: 40, height: 40 })).toBe(true)
    expect(readAsWordmark({ wordmark: false, width: 120, height: 30 })).toBe(true)
    expect(readAsWordmark({ wordmark: false, width: 40, height: 36 })).toBe(false)
  })
})

describe('a message that names a website', () => {
  it('finds a URL or a bare domain, never an email address', () => {
    expect(websiteIn('match acme.test please')).toBe('acme.test')
    expect(websiteIn('https://www.acme.co.uk/pricing.')).toBe('https://www.acme.co.uk/pricing')
    expect(websiteIn('write to hello@acme.test')).toBeNull()
    expect(websiteIn('make the buttons rounder')).toBeNull()
    expect(websiteIn('use 1.5 times the size')).toBeNull()
  })

  it('starts a match from a website alone or a website asked to be matched', () => {
    expect(isSiteStart('acme.test')).toBe(true)
    expect(isSiteStart('https://acme.test/')).toBe(true)
    expect(isSiteStart('Match our site, acme.test')).toBe(true)
    expect(isSiteStart('make it look like acme.test')).toBe(true)
  })

  it('is not a request about one part that mentions a site', () => {
    expect(isSiteStart('make the buttons rounder, like on acme.test')).toBe(false)
    expect(isSiteStart('link the menu to acme.test/help for support questions')).toBe(false)
    expect(isSiteStart('warmer colours')).toBe(false)
  })
})
