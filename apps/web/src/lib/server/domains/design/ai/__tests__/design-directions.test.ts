/**
 * A starting look is a whole portal: brand, shapes and layout, Home, the
 * words and the composer's wording, built on its preset through the same
 * checks as any change from the model.
 */
import { describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const { DIRECTIONS_EXAMPLE, lookDesign } = await import('../design-directions')

const every = [
  'welcome',
  'composer',
  'ideas',
  'roadmap',
  'updates',
  'help_search',
  'help_topics',
  'status',
  'contact',
  'links',
] as const
const allows = { blockTypes: every, checkCss: () => null }

describe('lookDesign', () => {
  it('makes the example a complete design, with nothing left out', () => {
    const { design, refused } = lookDesign(defaultDesign(), DIRECTIONS_EXAMPLE, allows)
    expect(refused).toEqual([])
    expect(design).toMatchObject({
      mode: 'light',
      brand: {
        light: { accent: '#d9480f', background: '#f7f5f2', ink: '#1c1b19' },
        fonts: {
          heading: { kind: 'bundled', id: 'space-grotesk' },
          body: { kind: 'bundled', id: 'inter' },
          headingWeight: 700,
        },
      },
      layout: { band: 'brand', cards: 'bordered', nav: 'pills', header: 'inline' },
      vocabulary: { post: 'suggestion', board: 'category' },
      nav: { home: { on: true, tab: true } },
    })
    expect(design.pages.feedback.copy.prompt).toEqual({
      en: 'Suggest a route, a class or some kit',
    })
    expect(design.pages.home.headline?.title).toEqual({ en: 'Climb with us' })
    expect(design.pages.home.blocks.map((block) => block.type)).toEqual([
      'composer',
      'contact',
      'ideas',
      'updates',
      'roadmap',
      'help_topics',
    ])
  })

  it('leaves out Home blocks for pages the workspace does not have, and keeps the rest', () => {
    const { design, refused } = lookDesign(defaultDesign(), DIRECTIONS_EXAMPLE, {
      ...allows,
      blockTypes: ['composer', 'ideas', 'roadmap', 'updates'],
    })
    expect(design.pages.home.blocks.map((block) => block.type)).toEqual([
      'composer',
      'ideas',
      'updates',
      'roadmap',
    ])
    expect(refused.map((change) => change.reason)).toEqual([
      'the contact block needs its page on',
      'the help topics block needs its page on',
    ])
  })

  it('puts a dark look’s page and text in dark mode', () => {
    const { design } = lookDesign(
      defaultDesign(),
      {
        ...DIRECTIONS_EXAMPLE,
        mode: 'dark',
        accent: '#c6ff3d',
        background: '#0b1020',
        ink: '#e8ecf8',
        surface: '',
      },
      allows
    )
    expect(design.mode).toBe('dark')
    expect(design.brand.dark).toMatchObject({ background: '#0b1020', ink: '#e8ecf8' })
    expect(design.brand.light.accent).toBe('#c6ff3d')
  })
})
