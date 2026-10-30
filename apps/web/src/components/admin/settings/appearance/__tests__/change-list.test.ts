/**
 * Review and publish names each change the way the Appearance controls do.
 */
import { describe, expect, it } from 'vitest'
import { changeLabel } from '../change-list'

describe('changeLabel', () => {
  it.each([
    ['brand.light.accent', 'Accent'],
    ['brand.dark.ink', 'Dark text'],
    ['brand.fonts.heading.id', 'Heading font'],
    ['layout.nav', 'Menu style'],
    ['pages.feedback.defaultSort', 'Default sort'],
    ['pages.feedback.headline.title.en', 'Headline'],
    ['pages.feedback.headline', 'Headline'],
    ['pages.feedback.headline.subtitle.de', 'Subtitle'],
    ['pages.feedback.welcome.show', 'Welcome message'],
    ['pages.feedback.welcome.body.content', 'Welcome message text'],
  ])('%s is %s', (path, label) => {
    expect(changeLabel(path)).toBe(label)
  })
})
