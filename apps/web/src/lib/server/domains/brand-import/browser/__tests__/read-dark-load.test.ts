/**
 * The dark read's two questions that need no browser: whether the page
 * answered a dark system as it stood, and whether the page loaded again under
 * a dark system is still the page that was read.
 */
import { describe, expect, it } from 'vitest'
import { answersScheme, samePageAgain } from '../read-helpers'
import { measureSchema } from '../measure-schema'

const light = { bg: 'rgb(255, 255, 255)', text: 'rgb(20, 20, 20)', textColor: 'rgb(20, 20, 20)' }

describe('answersScheme', () => {
  it('is true when the page or its words change colour once the system says dark', () => {
    expect(answersScheme(light, { ...light, bg: 'rgb(14, 14, 16)' })).toBe(true)
    expect(answersScheme(light, { ...light, textColor: 'rgb(239, 239, 241)' })).toBe(true)
    expect(answersScheme(light, { bg: light.bg, text: 'rgb(239, 239, 241)' })).toBe(true)
  })

  it('is false for a page that looks the same: it may take its scheme only as it loads', () => {
    expect(answersScheme(light, { ...light })).toBe(false)
    expect(answersScheme(light, { bg: light.bg, text: light.text })).toBe(false)
  })
})

describe('samePageAgain', () => {
  const page = { title: 'Twitch', status: 200 }

  it('is the same page under the same title and answer', () => {
    expect(samePageAgain(page, { title: ' Twitch ', status: 200 })).toBe(true)
    expect(samePageAgain({ title: 'Twitch', status: null }, { title: 'Twitch', status: 200 })).toBe(
      true
    )
  })

  it('is not when the second load was shown something else: a check, an error', () => {
    expect(samePageAgain(page, { title: 'Just a moment...', status: 200 })).toBe(false)
    expect(samePageAgain(page, { title: 'Twitch', status: 403 })).toBe(false)
    expect(samePageAgain(page, { title: 'Twitch', status: null })).toBe(false)
    expect(samePageAgain({ title: '', status: 200 }, { title: '', status: 200 })).toBe(false)
  })
})

describe('the dark read in a reply', () => {
  it('says when it was read from the page loaded dark', () => {
    const parsed = measureSchema.safeParse({
      title: 'Twitch',
      themeColor: null,
      bg: 'rgb(255, 255, 255)',
      text: 'rgb(20, 20, 20)',
      bodyFont: 'Inter',
      h1: null,
      buttons: [],
      logo: null,
      dark: { bg: 'rgb(14, 14, 16)', text: 'rgb(239, 239, 241)', loaded: true },
    })
    expect(parsed.success && parsed.data.dark?.loaded).toBe(true)
  })
})
