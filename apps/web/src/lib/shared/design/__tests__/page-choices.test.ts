/**
 * The choices three pages offer, Changelog, Help Center and Roadmap: kept in
 * the design document, optional so a stored design without them reads the
 * same, carried to the portal as attributes, named, and reachable by
 * Quackback AI.
 */
import { describe, expect, it } from 'vitest'
import { fieldGuide } from '@/lib/server/domains/design/ai/design-ai-guide'
import { applyDesignChanges, scopeFields } from '../apply-changes'
import { layoutAttributes } from '../components'
import { changeGroup, changeLabel } from '../labels'
import { outlineKeys, outlineOf } from '../outline'
import {
  PAGE_CHOICE_DEFAULTS,
  PAGE_CHOICE_FIELDS,
  pageChoiceAttributes,
  readPageChoices,
} from '../page-choices'
import { readStoredDesign } from '../stored-design'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

function withChoices(): PortalDesign {
  const design = defaultDesign()
  design.pages.changelog = {
    entries: 'cards',
    images: 'thumbnail',
    subscribe: 'under',
    shipped: false,
  }
  design.pages.help = {
    topics: 'list',
    popular: false,
    search: 'large',
    helpful: false,
    related: 2,
    contact: true,
  }
  design.pages.roadmap = { board: 'list', votes: false }
  design.pages.support = { suggest: false }
  return design
}

const pageKeys = (design: PortalDesign, page: Parameters<typeof outlineOf>[1]) =>
  outlineKeys(outlineOf(design, page)).filter((key) => !key.startsWith('site'))

describe('page choices in the design document', () => {
  it('keeps each choice, and refuses a value a page does not offer', () => {
    expect(portalDesign.parse(withChoices()).pages.changelog).toEqual({
      entries: 'cards',
      images: 'thumbnail',
      subscribe: 'under',
      shipped: false,
    })
    const bad = withChoices() as unknown as { pages: { help: { topics: string } } }
    bad.pages.help.topics = 'grid'
    expect(portalDesign.safeParse(bad).success).toBe(false)
    const extra = withChoices() as unknown as { pages: { roadmap: Record<string, unknown> } }
    extra.pages.roadmap.colour = 'red'
    expect(portalDesign.safeParse(extra).success).toBe(false)
  })

  it('reads a stored design without them unchanged', () => {
    const stored = defaultDesign()
    const read = readStoredDesign(JSON.parse(JSON.stringify(stored)))
    expect(read).toEqual({ design: stored, dropped: [] })
    expect('changelog' in read!.design.pages).toBe(false)
  })

  it('adds no attribute to a design without them, so its portal is as it was', () => {
    const before = layoutAttributes(defaultDesign())
    expect(Object.keys(before).filter((name) => /changelog|help|roadmap/.test(name))).toEqual([])
    expect(pageChoiceAttributes(defaultDesign())).toEqual({})
  })

  it('carries each choice as an attribute, and reads it back', () => {
    const attributes = layoutAttributes(withChoices())
    expect(attributes).toMatchObject({
      'data-qb-changelog-entries': 'cards',
      'data-qb-changelog-images': 'thumbnail',
      'data-qb-changelog-subscribe': 'under',
      'data-qb-changelog-shipped': 'off',
      'data-qb-help-topics': 'list',
      'data-qb-help-popular': 'off',
      'data-qb-help-search': 'large',
      'data-qb-help-helpful': 'off',
      'data-qb-help-related': '2',
      'data-qb-help-contact': 'on',
      'data-qb-roadmap-board': 'list',
      'data-qb-roadmap-votes': 'off',
      'data-qb-support-suggest': 'off',
    })
    expect(readPageChoices(attributes)).toEqual({
      changelog: { entries: 'cards', images: 'thumbnail', subscribe: 'under', shipped: false },
      help: {
        topics: 'list',
        popular: false,
        search: 'large',
        helpful: false,
        related: 2,
        contact: true,
      },
      roadmap: { board: 'list', votes: false },
      support: { suggest: false },
    })
  })

  it('reads today’s look when there are no attributes or a value it does not know', () => {
    expect(readPageChoices(undefined)).toEqual(PAGE_CHOICE_DEFAULTS)
    expect(readPageChoices({})).toEqual(PAGE_CHOICE_DEFAULTS)
    expect(readPageChoices({ 'data-qb-changelog-entries': 'spiral' }).changelog.entries).toBe(
      'timeline'
    )
    expect(readPageChoices({ 'data-qb-help-related': '7' }).help.related).toBe(4)
    expect(PAGE_CHOICE_DEFAULTS).toEqual({
      changelog: { entries: 'timeline', images: 'none', subscribe: 'beside', shipped: true },
      help: {
        topics: 'cards',
        popular: true,
        search: 'standard',
        helpful: true,
        related: 4,
        contact: false,
      },
      roadmap: { board: 'columns', votes: true },
      support: { suggest: true },
    })
  })

  it('keeps the support page’s request button words out of its attributes', () => {
    const design = defaultDesign()
    design.pages.support = { request: { en: 'Ask us' } }
    expect(portalDesign.parse(design).pages.support).toEqual({ request: { en: 'Ask us' } })
    expect(pageChoiceAttributes(design)).toEqual({})
  })
})

describe('page choices named, grouped and reachable by Quackback AI', () => {
  it('names each one', () => {
    for (const path of PAGE_CHOICE_FIELDS) {
      expect(changeLabel(path), path).not.toBe(path)
      expect(changeGroup(path), path).not.toBe('Other')
    }
    expect(changeLabel('pages.changelog.entries')).toBe('Changelog entries')
    expect(changeGroup('pages.help.topics')).toBe('Help Center page')
  })

  it('lets a request about the page set its choices', () => {
    const cases = [
      ['changelog', 'pages.changelog.entries', 'compact'],
      ['changelog', 'pages.changelog.shipped', false],
      ['help', 'pages.help.popular', false],
      ['help', 'pages.help.related', 2],
      ['roadmap', 'pages.roadmap.board', 'list'],
      ['support', 'pages.support.suggest', false],
      ['support', 'pages.support.request', { en: 'Ask us' }],
    ] as const
    for (const [scope, path, value] of cases) {
      const result = applyDesignChanges(defaultDesign(), [{ path, value }], scope)
      expect(result.outOfScope, path).toEqual([])
      expect(result.applied.map((change) => change.path)).toEqual([path])
    }
    expect(scopeFields('band')).toEqual(
      expect.arrayContaining(['pages.changelog.subscribe', 'pages.help.search'])
    )
  })

  it('keeps a request about one page off another’s', () => {
    const result = applyDesignChanges(
      defaultDesign(),
      [{ path: 'pages.roadmap.votes', value: false }],
      'changelog'
    )
    expect(result.outOfScope).toEqual(['pages.roadmap.votes'])
  })

  it('tells the AI every choice and its values', () => {
    const guide = fieldGuide([], false)
    for (const path of PAGE_CHOICE_FIELDS) expect(guide, path).toContain(path)
    expect(guide).toContain('timeline, cards, compact')
    expect(fieldGuide([], false, scopeFields('help'))).toContain('pages.help.topics')
  })
})

describe('page sections in the outline', () => {
  it('lists each page’s sections in the order a visitor meets them', () => {
    expect(pageKeys(defaultDesign(), 'changelog')).toEqual(['header', 'logo', 'hero', 'entries'])
    expect(pageKeys(defaultDesign(), 'help')).toEqual([
      'header',
      'logo',
      'hero',
      'topics',
      'popular',
      'article',
    ])
    expect(pageKeys(defaultDesign(), 'roadmap')).toEqual(['header', 'logo', 'hero', 'board'])
    expect(pageKeys(defaultDesign(), 'support')).toEqual(['header', 'logo', 'hero', 'request'])
  })

  it('lists Popular articles when off, so it can be turned back on', () => {
    const popular = (design: PortalDesign) =>
      outlineOf(design, 'help').find((node) => node.key === 'popular')?.label
    expect(popular(defaultDesign())).toBe('Popular articles')
    expect(popular(withChoices())).toBe('Popular articles (off)')
  })
})
