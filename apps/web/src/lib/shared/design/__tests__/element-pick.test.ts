// @vitest-environment happy-dom
/**
 * Picking on the canvas: the innermost addressable element under the
 * pointer, a registered part before an element kind, the block's own box
 * as the block, and a pick found again after the page draws afresh.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  kindNote,
  locatePick,
  pickAt,
  pickKey,
  pickLabel,
  pickName,
  pickOfKey,
  measuredValue,
  picksIn,
  reachOf,
  pickTraits,
} from '../element-pick'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const design: PortalDesign = portalDesign.parse({
  ...defaultDesign(),
  pages: {
    ...defaultDesign().pages,
    home: {
      headline: null,
      blocks: [
        { type: 'ideas', id: 'abcdefgh', sort: 'top', count: 3, grid: { x: 0, y: 0, w: 6, h: 2 } },
      ],
    },
  },
})

beforeEach(() => {
  document.body.innerHTML = `
    <div data-qb-page="home">
      <section data-qb-section="hero" data-qb-part="band">
        <h1 data-qb-part="headline"><span id="word">Ideas</span></h1>
        <div data-qb-part="composer"><button id="cta" data-qb-action=""><span id="cta-label">Go</span></button></div>
      </section>
      <section id="block" data-qb-section="block-abcdefgh" data-qb-part="home-block" data-qb-surface="card">
        <h2 id="heading" data-qb-part="section-heading">Top posts</h2>
        <article id="card1" data-qb-surface="card"><button id="vote1" data-qb-part="vote-button">3</button></article>
        <article id="card2" data-qb-surface="card"><button id="vote2" data-qb-part="vote-button">5</button></article>
        <a id="more" data-qb-link="" href="/">All posts</a>
      </section>
    </div>`
})

const at = (id: string) => pickAt(document.getElementById(id), design, 'home')

describe('pickAt', () => {
  it('picks the registered part the pointer is in, from the words inside it', () => {
    expect(at('cta-label')?.pick).toEqual({
      element: 'button',
      part: 'hero.home.cta',
      section: 'hero',
      index: 0,
    })
    expect(at('word')?.pick.part).toBe('hero.home.headline')
    expect(at('heading')?.pick).toMatchObject({
      element: 'heading',
      part: 'block.abcdefgh.heading',
    })
  })

  it('picks repeated content as its element kind, and which one it was', () => {
    expect(at('vote2')?.pick).toEqual({
      element: 'vote',
      part: null,
      section: 'block-abcdefgh',
      index: 1,
    })
    expect(at('card1')?.pick).toMatchObject({ element: 'card', part: null, index: 0 })
  })

  it('leaves the block’s own box to the block', () => {
    expect(at('block')).toBeNull()
  })

  it('finds a pick again, and names it', () => {
    const pick = at('vote2')!.pick
    expect(locatePick(document, pick, design, 'home')?.id).toBe('vote2')
    expect(pickOfKey(pickKey(pick))).toEqual(pick)
    expect(pickName(at('cta')!.pick, design, 'home')).toBe('Call to action · Hero')
    expect(pickName(pick, design, 'home')).toBe('Vote box')
    // Its own name alone, for where its section is said beside it.
    expect(pickLabel(at('cta')!.pick, design, 'home')).toBe('Call to action')
    expect(pickLabel(pick, design, 'home')).toBe('Vote box')
  })

  it('lists what a block holds, in reading order, for moving between them', () => {
    expect(picksIn(document, 'block-abcdefgh', design, 'home').map((p) => p.element)).toEqual([
      'heading',
      'card',
      'vote',
      'card',
      'vote',
      'link',
    ])
  })
})

describe('reachOf', () => {
  it('counts the shown elements of a kind on the page and in the pick’s block', () => {
    const vote = at('vote1')!.pick
    expect(reachOf(document, vote)).toEqual({ page: 2, block: 2 })
    document.getElementById('card2')!.setAttribute('hidden', '')
    expect(reachOf(document, vote)).toEqual({ page: 1, block: 1 })
  })

  it('has no block count outside a Home block, and counts parts with their kind', () => {
    const cta = at('cta')!.pick
    expect(reachOf(document, cta)).toEqual({ page: 1, block: null })
  })
})

describe('measuredValue', () => {
  it('reads a number an element is drawn with, in the property’s own unit', () => {
    const node = document.getElementById('cta')!
    node.style.borderRadius = '6px'
    node.style.fontSize = '16px'
    node.style.letterSpacing = '0.8px'
    node.style.fontWeight = '600'
    expect(measuredValue(node, 'radius')).toBe(6)
    expect(measuredValue(node, 'size')).toBe(16)
    expect(measuredValue(node, 'tracking')).toBe(0.05)
    expect(measuredValue(node, 'weight')).toBe(600)
  })

  it('has nothing for what it cannot read as a number', () => {
    const node = document.getElementById('cta')!
    expect(measuredValue(node, 'background')).toBeUndefined()
    node.style.letterSpacing = 'normal'
    node.style.fontSize = '16px'
    expect(measuredValue(node, 'tracking')).toBe(0)
  })
})

describe('what a pick is: its kind of content', () => {
  const blocks: PortalDesign = portalDesign.parse({
    ...defaultDesign(),
    pages: {
      ...defaultDesign().pages,
      home: {
        headline: null,
        blocks: [
          {
            type: 'ideas',
            id: 'abcdefgh',
            sort: 'top',
            count: 3,
            grid: { x: 0, y: 0, w: 6, h: 2 },
          },
          { type: 'updates', id: 'samplebk', count: 3, grid: { x: 6, y: 0, w: 6, h: 2 } },
        ],
      },
    },
  })
  beforeEach(() => {
    document.body.innerHTML = `
      <div data-qb-page="home">
        <section data-qb-section="hero" data-qb-part="band">
          <h1 id="headline" data-qb-part="headline" data-qb-words="home.title">Ideas</h1>
          <div data-qb-part="composer"><button id="cta" data-qb-action="">Go</button></div>
        </section>
        <section data-qb-section="block-abcdefgh" data-qb-part="home-block">
          <h2 id="heading" data-qb-part="section-heading" data-qb-words="block-abcdefgh.heading">Top posts</h2>
          <ul>
            <li><button id="vote1" data-qb-part="vote-button">3</button><span data-qb-part="status-badge" id="badge1">Planned</span><a id="t1" data-qb-item="post-title" href="/b/ideas/posts/p1"><span id="t1-words">Audit log</span></a></li>
            <li><button id="vote2" data-qb-part="vote-button">5</button><a id="t2" data-qb-item="post-title" href="/b/ideas/posts/p2">File attachments</a></li>
            <li><button id="vote3" data-qb-part="vote-button">8</button><a id="t3" data-qb-item="post-title" href="/b/ideas/posts/p3">User roles</a></li>
          </ul>
          <a id="more" data-qb-link="" data-qb-words="block-abcdefgh.link" href="/feedback">All posts</a>
        </section>
        <section data-qb-section="block-samplebk" data-qb-part="home-block">
          <span data-qb-sample="">Sample</span>
          <span id="sample-badge" data-qb-part="status-badge">Shipped</span>
          <span id="sample-title">A made-up update</span>
        </section>
      </div>`
  })
  const pickOf = (id: string) => pickAt(document.getElementById(id), blocks, 'home')
  const traitsOf = (id: string) => pickTraits(document, pickOf(id)!.pick, blocks, 'home')

  it('picks a data item as its block’s items, by the words inside it', () => {
    expect(pickOf('t1-words')?.pick).toEqual({
      element: 'body',
      part: 'block.abcdefgh.post-title',
      section: 'block-abcdefgh',
      index: 0,
    })
    expect(pickName(pickOf('t2')!.pick, blocks, 'home')).toBe('Post title · Top posts')
  })

  it('says static words are static, and editable where they are stored', () => {
    expect(traitsOf('headline')).toMatchObject({ kind: 'static', editable: true, count: 1 })
    expect(traitsOf('heading')).toMatchObject({ kind: 'static', editable: true })
    expect(kindNote(traitsOf('headline')!)).toBe('Static · edit in place')
  })

  it('says one data item styles every item of its kind in the block, and where it goes', () => {
    const traits = traitsOf('t2')!
    expect(traits).toMatchObject({ kind: 'dynamic', editable: false, count: 3 })
    expect(traits.others).toEqual([0, 2])
    expect(traits.link).toBe('/b/ideas/posts/p2')
    expect(kindNote(traits)).toBe('styling all 3')
    expect(traitsOf('badge1')).toMatchObject({ kind: 'dynamic', count: 1 })
    expect(kindNote(traitsOf('badge1')!)).toBe('Dynamic')
  })

  it('says the product’s own interface is style only, never edited in place', () => {
    expect(traitsOf('vote1')).toMatchObject({ kind: 'system', editable: false, count: 1 })
    expect(kindNote(traitsOf('vote1')!)).toBe('style only')
    expect(traitsOf('cta')).toMatchObject({ kind: 'static' })
  })

  it('gives a link its portal path, and the block’s own link too', () => {
    expect(traitsOf('more')).toMatchObject({ kind: 'static', link: '/feedback', editable: true })
    expect(traitsOf('heading')?.link).toBeNull()
  })

  it('leaves a builder-only sample unpicked as data', () => {
    expect(pickOf('sample-badge')).toBeNull()
    expect(pickOf('sample-title')).toBeNull()
  })
})
