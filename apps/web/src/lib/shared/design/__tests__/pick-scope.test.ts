// @vitest-environment happy-dom
/**
 * Every pick names what a change reaches with the noun of what was picked,
 * and counts what that change reaches on the page: a visible pick is never
 * "(0)". A data item (a post's title or excerpt) is picked as itself on
 * every page, at the same depth, and its change reaches every item of its
 * kind where it is listed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pickAt, pickKey, pickLabel, pickScope, reachOf, type ElementPick } from '../element-pick'
import type { OverridePage } from '../style-overrides'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const design: PortalDesign = portalDesign.parse({
  ...defaultDesign(),
  pages: {
    ...defaultDesign().pages,
    home: {
      headline: null,
      blocks: [
        { type: 'ideas', id: 'abcdefgh', sort: 'top', count: 3, grid: { x: 0, y: 0, w: 6, h: 2 } },
        { type: 'updates', id: 'updates1', count: 3, grid: { x: 6, y: 0, w: 6, h: 2 } },
      ],
    },
  },
})

/** Each page as the portal draws it, in the marks the canvas picks by. */
const FIXTURES: Record<string, { page: OverridePage; html: string }> = {
  home: {
    page: 'home',
    html: `
      <section data-qb-section="hero" data-qb-part="band">
        <h1 data-qb-part="headline">Ideas</h1>
        <p data-qb-part="subtitle">Tell us</p>
      </section>
      <section data-qb-section="block-abcdefgh" data-qb-part="home-block">
        <h2 data-qb-part="section-heading">Top posts</h2>
        <ul>
          <li><button data-qb-part="vote-button">3</button><a data-qb-item="post-title" href="/b/i/posts/p1">Audit log</a></li>
          <li><button data-qb-part="vote-button">5</button><a data-qb-item="post-title" href="/b/i/posts/p2">Roles</a></li>
        </ul>
        <a data-qb-link="" href="/">See all posts</a>
      </section>
      <section data-qb-section="block-updates1" data-qb-part="home-block">
        <h2 data-qb-part="section-heading">What is new</h2>
        <a data-qb-item="entry-title" href="/changelog/e1">Dark mode</a>
      </section>`,
  },
  feedback: {
    page: 'feedback',
    html: `
      <section data-qb-section="hero" data-qb-part="band">
        <h1 data-qb-part="headline">Feedback</h1>
      </section>
      <section data-qb-section="feed">
        <button data-qb-part="tab" aria-pressed="true">Top</button>
        <button data-qb-part="tab">New</button>
        <article data-qb-part="post-card" data-qb-post="" data-qb-surface="card">
          <button data-qb-part="vote-button">3</button>
          <span data-qb-part="status-badge">Open</span>
          <h2 data-qb-part="post-title">Audit log</h2>
          <p data-qb-part="post-excerpt">So we can see who did what</p>
          <span data-qb-part="tag">API</span>
        </article>
        <article data-qb-part="post-card" data-qb-post="" data-qb-surface="card">
          <button data-qb-part="vote-button">5</button>
          <h2 data-qb-part="post-title">Roles</h2>
        </article>
      </section>`,
  },
  roadmap: {
    page: 'roadmap',
    html: `
      <section data-qb-section="hero" data-qb-part="band">
        <h1 data-qb-part="headline">Roadmap</h1>
      </section>
      <div data-qb-section="board">
        <button data-qb-part="tab" aria-pressed="true">Now</button>
        <div data-qb-surface="card" data-qb-post="">
          <a data-qb-part="post-title" href="/b/i/posts/p1">Audit log</a>
        </div>
        <div data-qb-surface="card" data-qb-post="">
          <a data-qb-part="post-title" href="/b/i/posts/p2">Roles</a>
        </div>
      </div>`,
  },
}

afterEach(() => {
  document.body.innerHTML = ''
})

function picksOn(name: keyof typeof FIXTURES) {
  const { page, html } = FIXTURES[name]!
  document.body.innerHTML = `<div data-qb-page="${page}">${html}</div>`
  const seen = new Map<string, { pick: ElementPick; node: Element }>()
  for (const node of document.body.querySelectorAll('*')) {
    const found = pickAt(node, design, page)
    if (found && !seen.has(pickKey(found.pick))) seen.set(pickKey(found.pick), found)
  }
  return { page, picks: [...seen.values()] }
}

describe('what a pick says it changes', () => {
  for (const name of Object.keys(FIXTURES) as Array<keyof typeof FIXTURES>)
    it(`counts at least the pick itself, under the pick's own noun, on ${name}`, () => {
      const { page, picks } = picksOn(name)
      expect(picks.length).toBeGreaterThan(2)
      for (const { pick } of picks) {
        const scope = pickScope(pick, design, page)
        const reach = reachOf(document, pick, design, page)
        const said = `${pickKey(pick)}: ${scope.phrase} (${reach.page})`
        expect(reach.page, said).toBeGreaterThanOrEqual(1)
        if (reach.block !== null) expect(reach.block, said).toBeGreaterThanOrEqual(1)
        // The scope's noun is the pick's: a post title is never "every body text".
        expect(scope.phrase, said).toContain(scope.one.toLowerCase())
        if (scope.item) expect(scope.one, said).toBe(pickLabel(pick, design, page))
      }
    })

  it('picks a post title as itself, at the same depth, on every page that lists posts', () => {
    const titles = [
      ['home', '[data-qb-item=post-title]'],
      ['feedback', '[data-qb-part=post-title]'],
      ['roadmap', '[data-qb-part=post-title]'],
    ] as const
    for (const [name, selector] of titles) {
      const { page } = picksOn(name)
      const node = document.querySelector(selector)!
      const { pick } = pickAt(node, design, page)!
      const scope = pickScope(pick, design, page)
      expect(pickLabel(pick, design, page), name).toBe('Post title')
      expect(scope.item, name).toBe(true)
      expect(reachOf(document, pick, design, page).page, name).toBe(2)
    }
  })

  it('reaches every post title in its block, and says where', () => {
    const { page } = picksOn('home')
    const { pick } = pickAt(document.querySelector('[data-qb-item=post-title]'), design, page)!
    expect(pickScope(pick, design, page)).toEqual({
      item: true,
      one: 'Post title',
      phrase: 'every post title in Top posts',
    })
    const feed = picksOn('feedback')
    const excerpt = pickAt(
      document.querySelector('[data-qb-part=post-excerpt]'),
      design,
      'feedback'
    )!
    expect(pickScope(excerpt.pick, design, feed.page).phrase).toBe('every post excerpt in Feed')
  })

  it('says every one of its kind for anything else', () => {
    const { page } = picksOn('feedback')
    const { pick } = pickAt(document.querySelector('[data-qb-part=tag]'), design, page)!
    expect(pickScope(pick, design, page)).toEqual({ item: false, one: 'Tag', phrase: 'every tag' })
  })
})
