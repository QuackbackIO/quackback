/**
 * What Quackback AI is told comes from the registry, so it names every
 * block, setting and value the builder has, and the context of a request
 * shows what exists: blocks in reading order with their places in words,
 * the block picked in full, and the workspace's boards by name.
 */
import { describe, expect, it } from 'vitest'
import { blockOf, SECTION_TYPES } from '../blocks'
import { aiCatalogue, aiSettingsOf, describeBlock, designContext } from '../design-context'
import { applyOps, type OpWorld } from '../design-ops'
import { homeBlockTypes, newBlock } from '../home'
import { DESIGN_OPTIONS } from '../options'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { THEME_KEYS, themePath } from '../theme-keys'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const places = {
  boards: [{ id: 'board_01h455vb4pex5vsknk084sn02q', name: 'Mobile' }],
  roadmaps: [{ id: 'roadmap_01h455vb4pex5vsknk084sn02q', name: 'Public roadmap' }],
  categories: [{ id: 'kb_category_01h455vb4pex5vsknk084sn02q', name: 'Billing' }],
}

function design(): PortalDesign {
  const d = defaultDesign()
  d.nav.home = { on: true, tab: true }
  d.pages.home.blocks = [
    { id: 'search0001', type: 'help_search', grid: { x: 0, y: 3, w: 12, h: 1 } },
    {
      id: 'ideas00001',
      type: 'ideas',
      sort: 'new',
      count: 5,
      boardIds: [places.boards[0]!.id],
      grid: { x: 0, y: 0, w: 6, h: 1 },
    },
    { id: 'updates001', type: 'updates', count: 3, grid: { x: 6, y: 0, w: 6, h: 1 } },
  ] as PortalDesign['pages']['home']['blocks']
  return portalDesign.parse(d)
}

describe('the catalogue', () => {
  const text = aiCatalogue({ blockTypes: DESIGN_OPTIONS.blockType, places })

  it('names every block, its purpose, every setting the AI is told of and every value with its look', () => {
    for (const type of [...DESIGN_OPTIONS.blockType, 'hero'] as const) {
      const def = blockOf(type)!
      expect(text).toContain(`("${def.name}"): ${def.purpose}`)
      for (const field of aiSettingsOf(def).filter((each) => !each.aiUntold)) {
        expect(text, `${type}.${field.key}`).toContain(
          `${field.key} ("${field.label}"): ${field.about}`
        )
        if (field.kind === 'choice')
          for (const [value, looks] of Object.entries(field.looks))
            expect(text).toContain(`${value} (${looks})`)
      }
    }
    for (const type of SECTION_TYPES)
      for (const field of blockOf(type)!.fields) expect(text).toContain(field.about)
  })

  it('offers boards, roadmaps and topics by name, never by id', () => {
    expect(text).toContain('from Mobile')
    expect(text).toContain('from Public roadmap')
    expect(text).not.toContain('board_01h')
  })

  it('lists only the blocks this workspace’s Home can show', () => {
    const narrow = aiCatalogue({ blockTypes: ['welcome', 'links'], places })
    expect(narrow).not.toContain('help_search ("Help search")')
  })

  it('says what every Theme setting does, each on a field the design has', () => {
    for (const [name, key] of Object.entries(THEME_KEYS)) {
      expect(text).toContain(`${name}: ${key.about}`)
      expect(themePath(name)).toBe(key.path)
    }
  })
})

describe('every example the AI is shown', () => {
  it('applies to a Home with one of each block, refused by nothing', () => {
    const d = defaultDesign()
    d.nav.home = { on: true, tab: true }
    d.pages.home.blocks = DESIGN_OPTIONS.blockType.map((type, y) => newBlock(type, { y }))
    const doc = portalDesign.parse(d)
    const world: OpWorld = {
      gates: GATES,
      places: {
        ...places,
        boards: [...places.boards, { id: 'board_01h455vb4pex5vsknk084sn02r', name: 'Billing' }],
        columns: [
          { id: 'post_status_01h455vb4pex5vsknk084sn02q', name: 'Planned' },
          { id: 'post_status_01h455vb4pex5vsknk084sn02r', name: 'In progress' },
        ],
      },
      untrusted: {
        blockTypes: homeBlockTypes(GATES),
        links: new Set(['https://docs.example.com']),
        checkCss: () => 'no CSS',
      },
    }
    for (const type of [...DESIGN_OPTIONS.blockType, ...SECTION_TYPES, 'hero']) {
      for (const example of blockOf(type)!.examples) {
        // A second Top posts or Roadmap asks for an id, so examples add to a Home without them.
        const base =
          example.ops[0]?.op === 'add'
            ? {
                ...doc,
                pages: {
                  ...doc.pages,
                  home: {
                    ...doc.pages.home,
                    blocks: doc.pages.home.blocks.filter((b) => b.type !== example.ops[0]!.key),
                  },
                },
              }
            : doc
        const result = applyOps(base, world, example.ops)
        expect(result.refused, `${type}: ${example.request}`).toEqual([])
        expect(result.done.length + result.already.length, example.request).toBe(example.ops.length)
      }
    }
  })
})

describe('the context of a request', () => {
  it('lists Home’s blocks in reading order, each with its place in words and its settings', () => {
    const text = designContext(design(), { gates: GATES, places, page: 'home' })
    const lines = text.split('\n').filter((line) => line.startsWith('- '))
    expect(lines).toEqual([
      '- ideas00001 ideas ("Top posts"), row 1, left, half (6 of 12 columns): Newest · 5 posts · Mobile',
      '- updates001 updates ("Latest updates"), row 1, right, half (6 of 12 columns): 3 latest entries',
      '- search0001 help_search ("Help search"), row 2, full width',
    ])
    expect(text).toContain('The page shown: Home.')
    expect(text).toContain('Home is on, and visitors land on it.')
  })

  it('shows the block picked in full, its boards by name', () => {
    const text = designContext(design(), {
      gates: GATES,
      places,
      picked: { scope: 'home', blockId: 'ideas00001' },
    })
    expect(text).toContain(
      'The person picked Top posts (ideas00001); "this" and "it" mean it. Its settings now: heading (its usual); sort new; boardIds Mobile; count 5.'
    )
  })

  it('says a block’s settings left to their usual values only once the block sets them', () => {
    const d = design()
    const ideas = d.pages.home.blocks.find((block) => block.id === 'ideas00001')!
    Object.assign(ideas, { showComments: true, whenEmpty: 'hide' })
    const text = designContext(d, {
      gates: GATES,
      places,
      picked: { scope: 'home', blockId: 'ideas00001' },
    })
    expect(text).toContain('count 5; showComments true; whenEmpty hide.')
  })

  it('tells of the items’ settings, never of a block’s empty state or its other words', () => {
    // Told of those words, the AI wrote colour marks into block headings.
    const updates = describeBlock('updates', places)
    expect(updates).toContain('showDate')
    expect(updates).toContain('showSummary')
    for (const key of ['whenEmpty', 'emptyText', 'link'])
      expect(updates).not.toContain(`  ${key} (`)
    expect(describeBlock('contact', places)).not.toContain('  text (')
  })

  it('shows the hero, the pages, Theme and the menu as they are, defaults included', () => {
    const text = designContext(design(), { gates: GATES, places })
    expect(text).toContain('Hero now: look plain; imagePlace side')
    expect(text).toContain('height roomy')
    expect(text).toContain('help page: topics cards, popular true, search standard')
    expect(text).toContain('Theme now: mode auto;')
    expect(text).toContain('Menu, in order: home "Home" (visitors land here); feedback "Feedback"')
    expect(text).toContain(
      'The workspace’s boards: Mobile. Roadmaps: Public roadmap. Help topics: Billing.'
    )
  })

  it('places a composer in the hero there, not on the grid, and sized by the hero', () => {
    const d = design()
    d.pages.home.blocks = [{ ...newBlock('composer'), id: 'composer01' }]
    expect(designContext(d, { gates: GATES, places })).not.toContain('in the hero')
    d.pages.home.composer = 'band'
    expect(designContext(d, { gates: GATES, places })).toMatch(
      /composer01 composer \("[^"]+"\), in the hero under the headline, its width the hero's composerWidth/
    )
  })

  it('tells the AI the composer’s width in the hero, and its steps', () => {
    const d = design()
    d.pages.home.composer = 'band'
    d.pages.home.composerWidth = 'medium'
    expect(designContext(d, { gates: GATES, places })).toContain('composerWidth medium')
    expect(describeBlock('hero', places)).toMatch(/composerWidth[^\n]*narrow[^\n]*full/)
  })

  it('shows each text with its marks, and which marks each allows', () => {
    const d = design()
    d.pages.home.headline = {
      title: { en: 'Help shape what Acme grows into', fr: 'Aidez Acme' },
      subtitle: { en: 'Vote and comment' },
      accent: { style: 'colour', text: { en: 'Acme' } },
    }
    d.pages.titles = { roadmap: { title: { en: 'What is next' }, subtitle: {} } }
    d.pages.feedback.welcome = {
      show: true,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Read ' },
              {
                type: 'text',
                text: 'the docs',
                marks: [{ type: 'link', attrs: { href: 'https://docs.acme.com' } }],
              },
            ],
          },
        ],
      },
    }
    d.pages.home.blocks.push({
      id: 'welcome001',
      type: 'welcome',
      heading: { en: 'Hi there' },
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
        ],
      },
      grid: { x: 0, y: 4, w: 12, h: 1 },
    } as PortalDesign['pages']['home']['blocks'][number])
    const text = designContext(portalDesign.parse(d), { gates: GATES, places })
    expect(text).toContain('Headlines now')
    expect(text).toContain('[words]{accent}')
    expect(text).toContain('home "Help shape what [Acme]{accent} grows into"')
    expect(text).toContain('roadmap "What is next"')
    expect(text).toContain('home subtitle "Vote and comment"')
    expect(text).toContain('welcome001 heading "Hi there"')
    expect(text).toContain('welcome001 "**Hello**\\n\\nSecond"')
    expect(text).toContain('feedback welcome (shown) "Read [the docs](https://docs.acme.com)"')
    const fr = designContext(portalDesign.parse(d), { gates: GATES, places, locale: 'fr' })
    expect(fr).toContain('home "Aidez Acme"')
    const picked = designContext(portalDesign.parse(d), {
      gates: GATES,
      places,
      picked: { scope: 'home', blockId: 'welcome001' },
    })
    expect(picked).toContain('body "**Hello**\\n\\nSecond"')
  })
})

describe('element styles in the context', () => {
  it('shows the styles set now, site-wide and on a block, as paths the AI can write', () => {
    const d = design()
    d.style = { button: { hover: { background: '#1e1b4b' } } }
    const block = d.pages.home.blocks[0]!
    block.look = { style: { block: { base: { background: 'raised' } } } }
    const text = designContext(portalDesign.parse(d), { gates: GATES, places })
    expect(text).toContain('Element styles now: style.button.hover.background="#1e1b4b".')
    expect(text).toContain(`its own look style.block.base.background="raised"`)
    expect(designContext(design(), { gates: GATES, places })).toContain('Element styles now: none.')
  })

  it('names style keys as Theme does, and a block’s own look through set', () => {
    expect(themePath('style.card.hover.lift')).toBe('style.card.hover.lift')
    expect(themePath('style.card.focus.lift')).toBeNull()
    const d = design()
    const id = d.pages.home.blocks[0]!.id!
    const world: OpWorld = { gates: GATES, places }
    const result = applyOps(
      d,
      world,
      [
        { op: 'theme', key: 'style.link.hover.underline', value: 'underline' },
        { op: 'set', target: id, key: 'style.card.base.radius', value: '0' },
      ],
      { scope: 'site' }
    )
    expect(result.refused).toEqual([])
    expect(result.design.style?.link?.hover?.underline).toBe('underline')
    expect(
      result.design.pages.home.blocks.find((b) => b.id === id)!.look?.style?.card?.base?.radius
    ).toBe(0)
  })
})

describe('style operations as the model writes them', () => {
  it('takes a style set with no block as the whole portal’s, and a unit on an exact value', () => {
    const world: OpWorld = { gates: GATES, places }
    const result = applyOps(
      design(),
      world,
      [
        { op: 'set', target: '', key: 'style.chip.base.radius', value: '0' },
        { op: 'theme', key: 'heading.tracking', value: '0.1em' },
      ],
      { scope: 'site' }
    )
    expect(result.refused).toEqual([])
    expect(result.design.style?.chip?.base?.radius).toBe(0)
    expect(result.design.tune?.heading?.tracking).toBe(0.1)
  })
})

describe('near-miss style keys', () => {
  const world: OpWorld = { gates: GATES, places }
  it('reads an exact-value group, an exact value no part has, and a style on the hero', () => {
    const result = applyOps(
      design(),
      world,
      [
        { op: 'theme', key: 'tune.link', value: '{"underline":"hover"}' },
        { op: 'theme', key: 'body.colour', value: 'muted' },
        { op: 'set', target: 'hero', key: 'style.hero.base.borderWidth', value: '2' },
        { op: 'set', target: '', key: 'headingWeight', value: '700' },
        { op: 'set', target: 'body', key: 'style.body.base.size', value: '17' },
        { op: 'theme', key: 'tune.image.radius', value: '16' },
      ],
      { scope: 'site' }
    )
    expect(result.refused).toEqual([])
    expect(result.design.tune?.link?.underline).toBe('hover')
    expect(result.design.style?.body?.base?.color).toBe('muted')
    expect(result.design.style?.hero?.base?.borderWidth).toBe(2)
    expect(result.design.brand.fonts.headingWeight).toBe(700)
    expect(result.design.style?.body?.base?.size).toBe(17)
    expect(result.design.style?.image?.base?.radius).toBe(16)
  })
})
