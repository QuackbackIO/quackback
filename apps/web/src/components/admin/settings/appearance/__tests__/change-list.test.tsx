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
    ['nav.home.on', 'Home page'],
    ['nav.home.tab', 'Home in the menu'],
    ['pages.home.headline.title.en', 'Home headline'],
    ['pages.home.headline', 'Home headline'],
    ['pages.home.headline.subtitle.fr', 'Home subtitle'],
    ['pages.home.blocks', 'Home blocks'],
    ['nav.items', 'Menu'],
    ['nav.home.label', 'Home tab name'],
    ['vocabulary.post', 'What people post'],
    ['vocabulary.board', 'What groups them'],
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

  it('counts Home’s blocks rather than calling them changed', () => {
    const block = { type: 'status', width: 'third' }
    const { container } = render(
      <ChangeList changes={[{ path: 'pages.home.blocks', before: [], after: [block, block] }]} />
    )
    expect(container.textContent).toContain('No blocks')
    expect(container.textContent).toContain('2 blocks')
    expect(container.textContent).not.toContain('Changed')
  })

  it('counts what the menu shows', () => {
    const { container } = render(
      <ChangeList
        changes={[
          {
            path: 'nav.items',
            before: [
              { type: 'feedback', shown: true },
              { type: 'roadmap', shown: true },
            ],
            after: [
              { type: 'feedback', shown: true },
              { type: 'roadmap', shown: false },
              { type: 'link', id: 'x', label: 'Docs', url: 'https://example.com', newTab: true },
            ],
          },
        ]}
      />
    )
    expect(container.textContent).toContain('2 shown')
    expect(container.textContent).not.toContain('Changed')
  })

  it('calls an empty headline none, while a colour left unset stays automatic', () => {
    const { container } = render(
      <ChangeList
        changes={[
          { path: 'pages.home.headline.title.en', before: undefined, after: 'Hello' },
          { path: 'brand.light.raised', before: undefined, after: '#ffffff' },
        ]}
      />
    )
    const [headline, colour] = container.querySelectorAll('li')
    expect(headline!.textContent).toContain('None')
    expect(colour!.textContent).toContain('Automatic')
  })
})
