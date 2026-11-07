// @vitest-environment happy-dom
/**
 * Review and publish names each change the way the Appearance controls do.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChangeList, changeLabel, shownValue } from '../change-list'

describe('changeLabel', () => {
  it.each([
    ['brand.light.accent', 'Brand colour'],
    ['brand.light.support', 'Second colour'],
    ['brand.light.extra', 'Extra colours'],
    ['brand.light.extra.1', 'Extra colours'],
    ['layout.bandColour', 'Hero colour'],
    ['tune.subtitle.size', 'Subtitle size'],
    ['brand.dark.ink', 'Dark text'],
    ['brand.fonts.heading.id', 'Heading font'],
    ['layout.nav', 'Menu style'],
    ['pages.feedback.defaultSort', 'Default sort'],
    ['pages.feedback.headline.title.en', 'Headline'],
    ['pages.feedback.headline', 'Headline'],
    ['pages.feedback.headline.subtitle.de', 'Subtitle'],
    ['pages.feedback.welcome.show', 'Welcome message'],
    ['pages.feedback.welcome.body.content', 'Welcome message text'],
    ['brand.logo.mark.light.key', 'Icon'],
    ['brand.logo.mark.dark.key', 'Icon on dark'],
    ['brand.logo.wordmark.light.key', 'Full logo'],
    ['brand.logo.display', 'Full logo image'],
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
    ['pages.feedback.copy.prompt.en', 'Composer prompt'],
    ['pages.feedback.copy.submit.de', 'Submit button'],
    ['pages.feedback.copy.emptyTitle', 'Empty feed title'],
    ['tune.headline.size', 'Headline size'],
    ['tune.button.ink', 'Button label colour'],
    ['tune', 'Exact values'],
  ])('%s is %s', (path, label) => {
    expect(changeLabel(path)).toBe(label)
  })
})

describe('ChangeList', () => {
  it('never says who made a change', () => {
    const { container } = render(
      <ChangeList
        changes={[
          { path: 'layout.cards', before: 'bordered', after: 'raised' },
          { path: 'layout.width', before: 'default', after: 'wide' },
        ]}
      />
    )
    const rows = container.querySelectorAll('li')
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.textContent).not.toMatch(/Quackback AI|by you/i)
  })

  it('says the composer’s width in the hero in words', () => {
    const { container } = render(
      <ChangeList
        changes={[{ path: 'pages.home.composerWidth', before: undefined, after: 'narrow' }]}
      />
    )
    const row = container.querySelector('li')!
    expect(row.textContent).toContain('Home composer width')
    expect(row.textContent).toContain('Narrow')
    expect(row.textContent).not.toContain('narrow')
  })

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

  it('names a font by its family when it becomes the workspace’s own', () => {
    const { container } = render(
      <ChangeList
        changes={[
          { path: 'brand.fonts.heading.kind', before: 'bundled', after: 'uploaded' },
          { path: 'brand.fonts.heading.id', before: 'fraunces', after: undefined },
          { path: 'brand.fonts.heading.family', before: undefined, after: 'Unbounded' },
          { path: 'brand.fonts.heading.files', before: undefined, after: [] },
        ]}
      />
    )
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.querySelector('li')!.textContent).toBe('Heading fontFraunces→Unbounded')
  })

  it('counts the custom CSS in lines rather than showing it', () => {
    const { container } = render(
      <ChangeList changes={[{ path: 'css', before: undefined, after: 'a { b: c }\nd { e: f }' }]} />
    )
    expect(container.textContent).toContain('Custom CSS')
    expect(container.textContent).toContain('None')
    expect(container.textContent).toContain('2 lines')
    expect(container.textContent).not.toContain('a { b: c }')
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
    const rows = [...container.querySelectorAll('li')]
    const headline = rows.find((row) => row.textContent?.includes('Home headline'))
    const colour = rows.find((row) => row.textContent?.includes('Raised surfaces'))
    expect(headline!.textContent).toContain('None')
    expect(colour!.textContent).toContain('Automatic')
  })
})

describe('shownValue', () => {
  it('gives exact values their unit, and words in another language that language', () => {
    expect(shownValue('tune.headline.size', 48)).toBe('48 px')
    expect(shownValue('tune.headline.tracking', -0.02)).toBe('-0.02 em')
    expect(shownValue('tune.headline.weight', 600)).toBe(600)
    expect(shownValue('pages.home.blocks.0.heading', { de: 'Neues' })).toBe('Neues (German)')
  })
})

describe('inLanguage', () => {
  it('names a word field’s language when it is not English', async () => {
    const { inLanguage } = await import('@/lib/shared/design/labels')
    expect(inLanguage('Headline', 'en')).toBe('Headline')
    expect(inLanguage('Headline', 'de')).toBe('Headline (German)')
  })
})

describe('alsoChanges', () => {
  it('says what else a shared field reaches, and nothing for one of its own', async () => {
    const { alsoChanges } = await import('@/lib/shared/design/labels')
    expect(alsoChanges('shape.corners')).toMatch(/cards, fields and buttons/)
    expect(alsoChanges('tune.label.size')).toMatch(/menu/)
    expect(alsoChanges('tune.button.radius')).toBeNull()
  })
})

describe('ChangeList groups', () => {
  it('groups changes by the part of the portal they are in, in the order the parts show', () => {
    render(
      <ChangeList
        changes={[
          { path: 'pages.home.blocks', before: [], after: [] },
          { path: 'brand.light.accent', before: '#000000', after: '#0f766e' },
          { path: 'layout.band', before: 'none', after: 'tint' },
        ]}
      />
    )
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Site styles',
      'Hero',
      'Home',
    ])
  })
})

describe('page backgrounds in the change list', () => {
  it('names a background by its kind, and the pages with their own', () => {
    expect(shownValue('layout.background', { kind: 'gradient', stops: ['accent', 'page'] })).toBe(
      'Gradient'
    )
    expect(shownValue('layout.background', { kind: 'tint', colour: '#f7f5f2' })).toBe('Soft colour')
    expect(shownValue('layout.background', null)).toBe('Page colour')
    expect(
      shownValue('layout.pageBackgrounds', {
        roadmap: { kind: 'pattern', pattern: 'dots' },
        help: { kind: 'solid' },
      })
    ).toBe('Roadmap: Pattern, Help Center: Page colour')
  })
})
