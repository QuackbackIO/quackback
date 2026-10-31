// @vitest-environment happy-dom
/**
 * Review and publish names each change the way the Appearance controls do.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ChangeList, changeLabel } from '../change-list'

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
    ['brand.logo.mark.light.key', 'Logo'],
    ['brand.logo.mark.dark.key', 'Dark logo'],
    ['brand.logo.wordmark.light.key', 'Wordmark'],
    ['brand.logo.display', 'Logo display'],
    ['brand.favicon.key', 'Favicon'],
    ['brand.shareImage.key', 'Share image'],
  ])('%s is %s', (path, label) => {
    expect(changeLabel(path)).toBe(label)
  })
})

describe('ChangeList', () => {
  it('names an uploaded image, never its storage key', () => {
    const { container } = render(
      <ChangeList
        changes={[{ path: 'brand.logo.mark.light.key', before: undefined, after: 'logos/a/b.png' }]}
      />
    )
    expect(container.textContent).toContain('Uploaded image')
    expect(container.textContent).not.toContain('logos/')
  })
})
