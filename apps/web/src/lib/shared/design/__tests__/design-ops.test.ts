/**
 * The operations Quackback AI changes a design with: things named as a
 * person names them, places by the blocks around them, a refusal in plain
 * words instead of a throw, and each change labelled and undoable.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignChanges } from '../apply-changes'
import {
  addBlock,
  applyOp,
  applyOps,
  blocksInOrder,
  findBlock,
  menuOp,
  moveBlock,
  readPlace,
  removeBlock,
  resizeBlock,
  setBlockSetting,
  setHero,
  setPageSection,
  setTheme,
  setWords,
  type FlatOp,
  type OpWorld,
} from '../design-ops'
import { heroOf } from '../hero'
import { homeBlockTypes } from '../home'
import { landingOf, menuParts } from '../menu'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const MOBILE = 'board_01h455vb4pex5vsknk084sn02q'
const WEB = 'board_01h455vb4pex5vsknk084sn02r'
const PLANS = 'roadmap_01h455vb4pex5vsknk084sn02q'

const world: OpWorld = {
  gates: GATES,
  places: {
    boards: [
      { id: MOBILE, name: 'Mobile' },
      { id: WEB, name: 'Web app' },
    ],
    roadmaps: [{ id: PLANS, name: '2027 plans' }],
    categories: [],
  },
}
const model: OpWorld = {
  ...world,
  untrusted: { blockTypes: homeBlockTypes(GATES), links: new Set(), checkCss: () => 'no CSS' },
}

function design(): PortalDesign {
  const d = defaultDesign()
  d.nav.home = { on: true, tab: true }
  d.pages.home.blocks = [
    { id: 'composer01', type: 'composer', grid: { x: 0, y: 0, w: 8, h: 1 } },
    { id: 'status0001', type: 'status', grid: { x: 8, y: 0, w: 4, h: 1 } },
    {
      id: 'ideas00001',
      type: 'ideas',
      sort: 'trending',
      count: 3,
      grid: { x: 0, y: 1, w: 6, h: 1 },
    },
    { id: 'updates001', type: 'updates', count: 3, grid: { x: 6, y: 1, w: 6, h: 1 } },
    { id: 'search0001', type: 'help_search', grid: { x: 0, y: 2, w: 12, h: 1 } },
  ] as PortalDesign['pages']['home']['blocks']
  return portalDesign.parse(d)
}

const ok = <T extends { ok: boolean }>(result: T) => {
  if (!result.ok) throw new Error(`refused: ${(result as unknown as { refusal: string }).refusal}`)
  return result as Extract<T, { ok: true }>
}
const order = (d: PortalDesign) => blocksInOrder(d).map((block) => block.type)

describe('naming a Home block', () => {
  it('takes its id, its type or its name', () => {
    for (const ref of ['ideas00001', 'ideas', 'Top posts', 'top_posts'])
      expect(findBlock(design(), ref)).toMatchObject({ ok: true, block: { id: 'ideas00001' } })
  })

  it('asks for an id when Home has two of a kind, naming each', () => {
    const d = ok(addBlock(design(), world, 'ideas')).design
    const found = findBlock(d, 'Top posts')
    expect(found.ok).toBe(false)
    expect(!found.ok && found.refusal).toMatch(
      /2 Top posts blocks; name one by id: Top posts \(ideas00001\)/
    )
  })

  it('lists the blocks Home has when it has none of that name', () => {
    const found = findBlock(design(), 'roadmap')
    expect(!found.ok && found.refusal).toMatch(
      /no Roadmap block; its blocks are Write a post \(composer01\)/
    )
  })
})

describe('setBlockSetting', () => {
  it('chooses boards by name, never by an id the model must know', () => {
    const result = ok(setBlockSetting(design(), world, 'ideas', 'boardIds', ['Mobile', 'web app']))
    expect(result.design.pages.home.blocks[2]).toMatchObject({ boardIds: [MOBILE, WEB] })
    expect(result.label).toBe('Top posts: From Mobile and Web app')
  })

  it('refuses a board the workspace does not have, naming the ones it does', () => {
    expect(setBlockSetting(design(), world, 'ideas', 'boardIds', 'Desktop')).toEqual({
      ok: false,
      refusal: 'There is no board called “Desktop”; there are Mobile or Web app',
    })
  })

  it('reads a count, a choice by its name, and all boards again', () => {
    let d = ok(setBlockSetting(design(), world, 'ideas', 'count', '10')).design
    d = ok(setBlockSetting(d, world, 'ideas', 'Show', 'Newest')).design
    d = ok(setBlockSetting(d, world, 'ideas', 'boardIds', 'all')).design
    expect(d.pages.home.blocks[2]).toMatchObject({ count: 10, sort: 'new', boardIds: [] })
  })

  it('refuses a value the block does not take, and a setting it does not have', () => {
    expect(setBlockSetting(design(), world, 'ideas', 'count', 7)).toEqual({
      ok: false,
      refusal: 'Top posts: How many can be 3, 5 or 10',
    })
    expect(setBlockSetting(design(), world, 'ideas', 'colour', 'red')).toMatchObject({
      ok: false,
      refusal: expect.stringContaining(
        'it has heading, sort, count, boardIds, statusIds, showVotes, showStatus, showComments, whenEmpty, emptyText or link'
      ),
    })
  })

  it('writes a heading in the language shown', () => {
    const d = ok(
      setBlockSetting(design(), { ...world, locale: 'de' }, 'updates', 'heading', 'Neu')
    ).design
    expect(d.pages.home.blocks[3]).toMatchObject({ heading: { de: 'Neu' } })
  })
})

describe('placing blocks by the blocks around them', () => {
  it('reads places in words', () => {
    expect(readPlace('top')).toEqual({ kind: 'top' })
    expect(readPlace('beside: help_search')).toEqual({ kind: 'beside', ref: 'help_search' })
    expect(readPlace('after:ideas')).toEqual({ kind: 'below', ref: 'ideas' })
    expect(readPlace('somewhere nice')).toBeNull()
  })

  it('moves a block to the top, the rest following in order', () => {
    const result = ok(moveBlock(design(), world, 'help search', 'top'))
    expect(order(result.design)).toEqual(['help_search', 'composer', 'status', 'ideas', 'updates'])
    expect(result.label).toBe('Move Help search to the top')
  })

  it('moves a block below and above another, even moving down', () => {
    const below = ok(moveBlock(design(), world, 'composer', 'below:ideas')).design.pages.home.blocks
    const ideas = below.find((block) => block.type === 'ideas')!.grid
    expect(below.find((block) => block.type === 'composer')!.grid).toMatchObject({
      x: ideas.x,
      y: ideas.y + ideas.h,
    })
    expect(order(ok(moveBlock(design(), world, 'status', 'above:help_search')).design)).toEqual([
      'composer',
      'ideas',
      'updates',
      'status',
      'help_search',
    ])
  })

  it('puts a block beside another, sharing the row when it is full', () => {
    const d = ok(moveBlock(design(), world, 'status', 'beside:help_search')).design
    const status = d.pages.home.blocks.find((block) => block.type === 'status')!
    const search = d.pages.home.blocks.find((block) => block.type === 'help_search')!
    expect(status.grid.y).toBe(search.grid.y)
    expect(status.grid.w + search.grid.w).toBeLessThanOrEqual(12)
  })

  it('adds a block beside another, taking a row’s room or sharing it', () => {
    const d = ok(addBlock(design(), world, 'roadmap', 'beside:ideas')).design
    const roadmap = d.pages.home.blocks.find((block) => block.type === 'roadmap')!
    expect(roadmap.grid.y).toBe(d.pages.home.blocks.find((block) => block.type === 'ideas')!.grid.y)
  })

  it('adds a block with its settings, at the bottom when no place is given', () => {
    const result = ok(
      addBlock(design(), world, 'Top posts', undefined, { count: 5, boardIds: ['Mobile'] })
    )
    expect(blocksInOrder(result.design).at(-1)).toMatchObject({
      type: 'ideas',
      count: 5,
      boardIds: [MOBILE],
    })
    expect(result.label).toBe('Add Top posts to the bottom')
  })

  it('refuses a second of a block Home holds once, a block whose page is off, and a place it cannot read', () => {
    expect(addBlock(design(), world, 'status')).toEqual({
      ok: false,
      refusal: 'Home already has Status (status0001), and holds one; move it instead',
    })
    expect(
      addBlock(design(), { ...world, gates: { ...GATES, roadmap: false } }, 'roadmap')
    ).toEqual({
      ok: false,
      refusal: 'Roadmap needs its page on',
    })
    expect(moveBlock(design(), world, 'status', 'the middle')).toMatchObject({ ok: false })
  })

  it('resizes in words, moving left to fit, never under the least width', () => {
    const full = ok(resizeBlock(design(), world, 'updates', 'full')).design
    expect(full.pages.home.blocks.find((b) => b.type === 'updates')!.grid).toMatchObject({
      x: 0,
      w: 12,
    })
    expect(
      ok(resizeBlock(design(), world, 'ideas', 'wider')).design.pages.home.blocks.find(
        (b) => b.type === 'ideas'
      )!.grid.w
    ).toBe(8)
    expect(resizeBlock(design(), world, 'ideas', 'quarter')).toEqual({
      ok: false,
      refusal: 'Top posts is at least 4 columns wide',
    })
  })

  it('removes a block, the rest floating up', () => {
    const d = ok(removeBlock(design(), world, 'status')).design
    expect(order(d)).toEqual(['composer', 'ideas', 'updates', 'help_search'])
  })
})

describe('setHero, setPageSection, setTheme and setWords', () => {
  it('sets the hero by a look’s name, and refuses an image the model cannot upload', () => {
    const result = ok(setHero(design(), world, 'look', 'Tint'))
    expect(heroOf(result.design).look).toBe('tint')
    expect(result.label).toBe('Hero look: Tint')
    expect(setHero(design(), world, 'image', { key: 'x' })).toMatchObject({ ok: false })
  })

  it('tells the roadmap page from a Roadmap block by the setting', () => {
    const withBlock = ok(addBlock(design(), world, 'roadmap')).design
    const page = ok(
      applyOp(withBlock, world, { op: 'set', target: 'roadmap', key: 'board', value: 'list' })
    )
    expect(page.design.pages.roadmap).toEqual({ board: 'list' })
    const block = ok(
      applyOp(withBlock, world, {
        op: 'set',
        target: 'roadmap',
        key: 'roadmapId',
        value: '2027 plans',
      })
    )
    expect(block.design.pages.home.blocks.find((b) => b.type === 'roadmap')).toMatchObject({
      roadmapId: PLANS,
    })
  })

  it('opens the feed on a board by its name, and on every board again', () => {
    const result = ok(setPageSection(design(), world, 'feedback', 'opensOn', 'Web app'))
    expect(result.design.pages.feedback.openOn).toBe(WEB)
    expect(result.label).toBe('Feed opens on: Web app')
    const all = ok(setPageSection(result.design, world, 'feedback', 'opensOn', 'all boards'))
    expect(all.design.pages.feedback).not.toHaveProperty('openOn')
    expect(setPageSection(design(), world, 'feedback', 'opensOn', 'Nowhere')).toMatchObject({
      ok: false,
    })
  })

  it('leaves a page choice back at its usual value out of the design', () => {
    const d = ok(setPageSection(design(), world, 'help', 'search', 'large')).design
    expect(d.pages.help).toEqual({ search: 'large' })
    expect(
      ok(setPageSection(d, world, 'help', 'search', 'standard')).design.pages.help
    ).toBeUndefined()
    expect(setPageSection(design(), world, 'help', 'colour', 'red')).toMatchObject({
      ok: false,
      refusal: expect.stringContaining(
        'it has topics, popular, search, helpful, related or contact'
      ),
    })
  })

  it('sets the theme by its names, fonts by theirs, and refuses a key it has not', () => {
    expect(ok(setTheme(design(), world, 'accent', '#0f766e')).design.brand.light.accent).toBe(
      '#0f766e'
    )
    expect(
      ok(setTheme(design(), world, 'headingFont', 'IBM Plex Sans')).design.brand.fonts.heading
    ).toEqual({
      kind: 'bundled',
      id: 'ibm-plex-sans',
    })
    expect(ok(setTheme(design(), world, 'corners', 'pill')).design.shape.corners).toBe('pill')
    expect(ok(setTheme(design(), world, 'headline.size', '76')).design.tune?.headline?.size).toBe(
      76
    )
    expect(setTheme(design(), world, 'corners', 'very round')).toEqual({
      ok: false,
      refusal: 'Corners can be sharp, subtle, rounded or pill',
    })
    expect(setTheme(design(), world, 'sparkle', 'on')).toMatchObject({ ok: false })
  })

  it('keeps focus rings neutral: a ring width, never a ring colour', () => {
    expect(setTheme(design(), world, 'style.button.focus.ring', 'accent')).toMatchObject({
      ok: false,
    })
    expect(setTheme(design(), world, 'styleDark.input.focus.ring', '#ffffff')).toMatchObject({
      ok: false,
    })
    expect(ok(setTheme(design(), world, 'style.button.focus.ringWidth', '3')).design.style).toEqual(
      { button: { focus: { ringWidth: 3 } } }
    )
  })

  it('writes a page’s words where they belong', () => {
    expect(
      ok(setWords(design(), world, 'home', 'title', 'Hi')).design.pages.home.headline?.title
    ).toEqual({ en: 'Hi' })
    expect(
      ok(setWords(design(), world, 'roadmap', 'title', 'Plans')).design.pages.titles?.roadmap?.title
    ).toEqual({
      en: 'Plans',
    })
    const welcome = ok(setWords(design(), world, 'feedback', 'welcome', 'Hello')).design.pages
      .feedback.welcome
    expect(welcome.show).toBe(true)
  })
})

describe('menuOp', () => {
  it('renames an item by its page’s own name', () => {
    const result = ok(menuOp(design(), world, 'Changelog', 'rename', 'What’s new'))
    expect(menuParts(result.design, GATES).find((p) => p.id === 'changelog')!.label).toBe(
      'What’s new'
    )
    expect(result.label).toBe('Rename Changelog to What’s new')
  })

  it('hides, moves and lands, each refused in words where it cannot', () => {
    expect(
      ok(menuOp(design(), world, 'status', 'hide')).design.nav.items.find(
        (i) => i.type === 'status'
      )
    ).toMatchObject({ shown: false })
    expect(menuOp(design(), world, 'feedback', 'left')).toEqual({
      ok: false,
      refusal: 'Feedback is first already',
    })
    const landed = ok(menuOp(design(), world, 'roadmap', 'land')).design
    expect(landingOf(landed, GATES)).toBe('roadmap')
    expect(menuOp(landed, world, 'roadmap', 'hide')).toEqual({
      ok: false,
      refusal: 'Roadmap is where visitors land, so it stays in the menu',
    })
  })

  it('adds a link only the person gave', () => {
    expect(menuOp(design(), model, 'Docs', 'addlink', 'https://docs.example.com')).toMatchObject({
      ok: false,
      refusal: expect.stringContaining('is not a link you gave'),
    })
  })
})

describe('applyOps', () => {
  const ops: FlatOp[] = [
    { op: 'set', target: 'ideas', key: 'count', value: '10' },
    { op: 'set', target: 'ideas', key: 'count', value: '7' },
    { op: 'move', target: 'help_search', value: 'top' },
    { op: 'theme', key: 'accent', value: '#0f766e' },
  ]

  it('applies what it can, says why for the rest, and makes each field one labelled change', () => {
    const result = applyOps(design(), model, ops)
    expect(result.refused).toEqual([
      { op: ops[1], reason: 'Top posts: How many can be 3, 5 or 10' },
    ])
    expect(result.applied.map((change) => [change.path, change.label])).toEqual([
      ['pages.home.blocks', 'Top posts: How many 10; Move Help search to the top'],
      ['brand.light.accent', 'Brand colour to #0f766e'],
    ])
  })

  it('undoes each change by writing its before back', () => {
    const before = design()
    const result = applyOps(before, model, ops)
    const undone = applyDesignChanges(
      result.design,
      result.applied.map((change) => ({ path: change.path, value: change.before })),
      'site'
    ).design
    expect(undone.pages.home.blocks).toEqual(before.pages.home.blocks)
    expect(undone.brand.light.accent).toBe(before.brand.light.accent)
  })

  it('keeps a request about a picked block to that block', () => {
    const result = applyOps(design(), model, ops, { scope: 'home', blockId: 'ideas00001' })
    expect(result.done.map((done) => done.op)).toEqual([ops[0]])
    expect(result.outOfScope).toEqual([ops[2], ops[3]])
  })

  it('keeps a picked block from reaching the page of the same name', () => {
    // "roadmap" names a Home block and a page; votes is the page's setting.
    const d = ok(addBlock(design(), world, 'roadmap')).design
    const roadmap = d.pages.home.blocks.find((block) => block.type === 'roadmap')!
    const op = { op: 'set', target: 'roadmap', key: 'votes', value: 'false' } as const
    // Unscoped, the operation does change the roadmap page.
    const unscoped = applyOps(d, model, [op])
    expect(unscoped.applied.map((change) => change.path)).toEqual(['pages.roadmap'])
    expect(unscoped.design.pages.roadmap).toMatchObject({ votes: false })
    const result = applyOps(d, model, [op], { scope: 'home', blockId: roadmap.id })
    expect(result.done).toEqual([])
    expect(result.applied).toEqual([])
    expect(result.outOfScope).toEqual([op])
    expect(result.design).toBe(d)
  })

  it('says what is already so, and never throws on an operation it cannot read', () => {
    const result = applyOps(design(), model, [
      { op: 'set', target: 'ideas', key: 'count', value: '3' },
      { op: 'explode' as never },
      { op: 'move' },
      { op: 'set', target: 'hero', key: 'look', value: '{"bad": true}' },
    ])
    expect(result.already.map((each) => each.label)).toEqual(['Top posts: How many 3'])
    expect(result.refused).toHaveLength(3)
    expect(result.applied).toEqual([])
  })
})

describe('words with marks', () => {
  const withWelcome = () => {
    const d = design()
    d.pages.home.headline = { title: { en: 'Help shape what Acme grows into' }, subtitle: {} }
    d.pages.home.blocks.push({
      id: 'welcome001',
      type: 'welcome',
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello there.' }] }],
      },
      grid: { x: 0, y: 3, w: 12, h: 1 },
    } as PortalDesign['pages']['home']['blocks'][number])
    return portalDesign.parse(d)
  }
  const docs = {
    ...model,
    untrusted: { ...model.untrusted!, links: new Set(['https://docs.acme.com']) },
  }
  const welcomeBody = (d: PortalDesign) =>
    (d.pages.home.blocks.find((b) => b.type === 'welcome') as { body: unknown }).body

  it('sets a headline’s phrase apart from its markup, labelled as the editor labels it', () => {
    const result = ok(
      setWords(withWelcome(), model, 'home', 'title', 'Help shape what Acme [grows]{accent} into')
    )
    expect(result.design.pages.home.headline).toMatchObject({
      title: { en: 'Help shape what Acme grows into' },
      accent: { style: 'colour', text: { en: 'grows' } },
    })
    expect(result.label).toBe('Headline: accent')
    const lighter = ok(
      setWords(result.design, model, 'home', 'title', 'Help shape what [Acme grows into]{lighter}')
    )
    expect(lighter.design.pages.home.headline?.accent).toEqual({
      style: 'muted',
      text: { en: 'Acme grows into' },
    })
  })

  it('clears the accent when the headline is written as plain words', () => {
    const d = withWelcome()
    d.pages.home.headline!.accent = { style: 'highlight', text: { en: 'Acme' } }
    const result = ok(setWords(d, model, 'home', 'title', 'Help shape what Acme grows into'))
    expect(result.design.pages.home.headline?.accent).toBeUndefined()
    expect(result.label).toBe('Headline: accent')
    const renamed = ok(setWords(d, model, 'home', 'title', 'Hi'))
    expect(renamed.design.pages.home.headline?.title).toEqual({ en: 'Hi' })
    expect(renamed.label).toBe('Home headline: “Hi”')
  })

  it('sets a page title’s phrase apart in the language shown', () => {
    const result = ok(
      setWords(
        design(),
        { ...model, locale: 'fr' },
        'roadmap',
        'title',
        'Notre [feuille]{highlight} de route'
      )
    )
    expect(result.design.pages.titles?.roadmap).toMatchObject({
      title: { fr: 'Notre feuille de route' },
      accent: { style: 'highlight', text: { fr: 'feuille' } },
    })
  })

  it('refuses two phrases, an unknown look, and marks on plain words', () => {
    expect(setWords(design(), model, 'home', 'title', '[A]{accent} and [B]{accent}')).toMatchObject(
      {
        ok: false,
        refusal: expect.stringContaining('one phrase'),
      }
    )
    expect(setWords(design(), model, 'home', 'title', 'A [B]{sparkle}')).toMatchObject({
      ok: false,
      refusal: expect.stringContaining('{accent}, {highlight} or {lighter}'),
    })
    for (const [target, key, text] of [
      ['home', 'subtitle', 'Tell us [more]{accent}'],
      ['feedback', 'prompt', 'What would **help**?'],
      ['feedback', 'submit', '[Send](https://x.com)'],
      ['feedback', 'empty', 'No ideas *yet*'],
    ] as const)
      expect(setWords(design(), model, target, key, text), `${target} ${key}`).toMatchObject({
        ok: false,
        refusal: expect.stringContaining('plain words'),
      })
    expect(
      applyOp(withWelcome(), model, {
        op: 'set',
        target: 'welcome001',
        key: 'heading',
        value: 'Say [hi]{accent}',
      })
    ).toMatchObject({ ok: false, refusal: expect.stringContaining('plain words') })
  })

  it('writes a Welcome block’s words from markdown, bold, italic, links and lists', () => {
    const result = ok(
      applyOp(withWelcome(), docs, {
        op: 'set',
        target: 'welcome001',
        key: 'body',
        value: '**Hello there.** Read [our docs](https://docs.acme.com).\n\n- one\n- *two*',
      })
    )
    expect(welcomeBody(result.design)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello there.', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' Read ' },
            {
              type: 'text',
              text: 'our docs',
              marks: [{ type: 'link', attrs: { href: 'https://docs.acme.com' } }],
            },
            { type: 'text', text: '.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'two', marks: [{ type: 'italic' }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(result.label).toBe('Welcome: words')
    const bolded = ok(
      applyOp(withWelcome(), model, {
        op: 'set',
        target: 'welcome001',
        key: 'body',
        value: '**Hello there.**',
      })
    )
    expect(bolded.label).toBe('Welcome: formatting')
  })

  it('refuses a link the person did not give, and one that is not a web or email address', () => {
    const invented = applyOp(withWelcome(), model, {
      op: 'set',
      target: 'welcome001',
      key: 'body',
      value: 'See [docs](https://evil.example.com)',
    })
    expect(invented).toMatchObject({
      ok: false,
      refusal: expect.stringContaining('not a link you gave'),
    })
    const script = applyOp(withWelcome(), docs, {
      op: 'set',
      target: 'welcome001',
      key: 'body',
      value: 'See [docs](javascript:alert(1))',
    })
    expect(script).toMatchObject({ ok: false, refusal: expect.stringContaining('web address') })
    const welcome = setWords(design(), model, 'feedback', 'welcome', 'Mail [us](mailto:a@b.co)')
    expect(welcome).toMatchObject({
      ok: false,
      refusal: expect.stringContaining('not a link you gave'),
    })
  })

  it('writes the feed’s welcome message from markdown', () => {
    const result = ok(
      setWords(
        design(),
        docs,
        'feedback',
        'welcome',
        'Hi! **Vote** for [docs](https://docs.acme.com)'
      )
    )
    const body = result.design.pages.feedback.welcome
    expect(body.show).toBe(true)
    expect(JSON.stringify(body.body)).toContain('"href":"https://docs.acme.com"')
    expect(JSON.stringify(body.body)).toContain('"type":"bold"')
    expect(setWords(design(), model, 'feedback', 'welcome', 'Hi').ok).toBe(true)
  })
})

describe('a brand image a website read stored', () => {
  const key = 'logos/site/acme.test/1-favicon.png'
  const trusted = (files: string[]) => ({
    ...world,
    untrusted: {
      blockTypes: [],
      links: new Set<string>(),
      checkCss: () => null,
      files: new Set(files),
    },
  })

  it('is set by its key when the request stored it', () => {
    const out = setTheme(design(), trusted([key]), 'favicon', { key })
    expect(ok(out).design.brand.favicon).toEqual({ key })
    expect(
      ok(setTheme(design(), trusted([key]), 'brand.logo', key)).design.brand.logo.mark.light
    ).toEqual({ key })
  })

  it('is refused when the model names a key it was not given, or no key', () => {
    expect(setTheme(design(), trusted([]), 'favicon', { key }).ok).toBe(false)
    expect(setTheme(design(), trusted([key]), 'shareImage', 'nothing here').ok).toBe(false)
    expect(setTheme(design(), trusted([key]), 'wordmark', {}).ok).toBe(false)
  })
})
