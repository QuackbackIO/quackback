/**
 * How far an Ask AI request may reach from what was picked: the choices the
 * composer's chip offers (the panel's own default first), the pages a change
 * lands on, and the short clause a reply ends with when its changes land
 * beyond the page shown.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import {
  alsoNotes,
  changePages,
  fieldPage,
  oneSentence,
  reachChoices,
  reachClause,
  withReach,
} from '../ai-reach'
import type { AppliedDesignChange } from '../apply-changes'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function design(): PortalDesign {
  const d = defaultDesign()
  d.nav.home.on = true
  return portalDesign.parse(d)
}

const change = (path: string, before: unknown = null, after: unknown = 'x') =>
  ({ path, before, after }) as AppliedDesignChange

describe('the reach a pick offers', () => {
  it('starts the hero at every page it is on, with this page as the narrower one', () => {
    const choices = reachChoices(design(), { scope: 'band' }, 'home', GATES)
    expect(choices.map((c) => c.reach)).toEqual(['every', 'page'])
    // Home, Feedback, Roadmap, Changelog, Help Center and Support have a hero.
    expect(choices[0]!.words).toBe('every page (6)')
    expect(choices[1]!.words).toBe('this page')
  })

  it('counts only the pages the workspace has', () => {
    const choices = reachChoices(design(), { scope: 'band' }, 'home', {
      ...GATES,
      roadmap: false,
      changelog: false,
    })
    expect(choices[0]!.words).toBe('every page (4)')
  })

  it('starts a picked element shared, as its panel does, with this page and just this one', () => {
    const choices = reachChoices(
      design(),
      { scope: 'band', element: { element: 'button', part: 'hero.home.cta' } },
      'home',
      GATES
    )
    expect(choices).toEqual([
      { reach: 'every', words: 'every main button' },
      { reach: 'page', words: 'this page' },
      { reach: 'one', words: 'just this one' },
    ])
  })

  it('keeps a Home block to itself', () => {
    expect(reachChoices(design(), { scope: 'home', blockId: 'abc' }, 'home', GATES)).toEqual([
      { reach: 'one', words: 'on Home' },
    ])
  })

  it('offers nothing for the whole site or its styles', () => {
    expect(reachChoices(design(), { scope: 'site' }, 'home', GATES)).toEqual([])
    expect(reachChoices(design(), { scope: 'brand' }, 'home', GATES)).toEqual([])
  })
})

describe('the pages a change lands on', () => {
  it('reads a page’s own fields as that page', () => {
    expect(fieldPage('pages.home.headline.title')).toBe('home')
    expect(fieldPage('pages.titles.roadmap.title')).toBe('roadmap')
    expect(fieldPage('layout.pageBackgrounds.help')).toBe('help')
    expect(fieldPage('pages.home.blocks')).toBe('home')
    expect(fieldPage('layout.hero')).toBeNull()
    expect(fieldPage('tune.button.radius')).toBeNull()
  })

  it('reads a shared field as every page', () => {
    expect(changePages(design(), change('layout.hero'))).toBe('every')
  })

  it('reads an override by its target', () => {
    const d = design()
    const page = changePages(
      d,
      change('overrides', null, [
        {
          id: 'part:hero.home.cta:button',
          target: { scope: 'part', part: 'hero.home.cta', element: 'button' },
        },
      ])
    )
    expect(page).toEqual(new Set(['home']))
    const onRoadmap = changePages(
      d,
      change('overrides', null, [
        {
          id: 'page:roadmap:button',
          target: { scope: 'page', page: 'roadmap', element: 'button' },
        },
      ])
    )
    expect(onRoadmap).toEqual(new Set(['roadmap']))
  })
})

describe('the reach clause', () => {
  it('says “on every page” when a hero change lands beyond the page shown', () => {
    expect(reachClause(design(), [change('layout.hero')], { scope: 'band', page: 'home' })).toBe(
      'on every page'
    )
  })

  it('says nothing when the change stays on the page shown', () => {
    expect(
      reachClause(design(), [change('pages.home.headline.title')], { scope: 'band', page: 'home' })
    ).toBe('')
  })

  it('says “on other pages too” for a change that lands on a page not shown', () => {
    expect(
      reachClause(design(), [change('pages.titles.roadmap.title')], {
        scope: 'band',
        page: 'home',
      })
    ).toBe('on other pages too')
  })

  it('says nothing for the whole site, its styles, or a part on every page anyway', () => {
    const changes = [change('layout.hero')]
    expect(reachClause(design(), changes, { scope: 'site', page: 'home' })).toBe('')
    expect(reachClause(design(), changes, { scope: 'brand', page: 'home' })).toBe('')
    expect(
      reachClause(design(), [change('layout.header')], { scope: 'header', page: 'home' })
    ).toBe('')
  })

  it('ends a sentence with it', () => {
    expect(withReach('The hero is calmer.', 'on every page')).toBe(
      'The hero is calmer, on every page.'
    )
    expect(withReach('The hero is calmer!', '')).toBe('The hero is calmer!')
  })
})

describe('what else a change reaches', () => {
  it('names the other parts a shared field changes, for a pick narrower than the site', () => {
    expect(alsoNotes([change('shape.corners')], 'button')).toEqual([
      'Also changes the corners of cards, fields and buttons.',
    ])
    expect(alsoNotes([change('tune.button.radius')], 'button')).toEqual([])
    expect(alsoNotes([change('shape.corners')], 'site')).toEqual([])
  })
})

describe('one sentence', () => {
  it('keeps the first sentence of a reply', () => {
    expect(oneSentence('The hero is calmer. I also softened the edges.')).toBe(
      'The hero is calmer.'
    )
    expect(oneSentence('Buttons are 48px tall on phones.')).toBe('Buttons are 48px tall on phones.')
    expect(oneSentence('No full stop')).toBe('No full stop')
  })

  it('ends a sentence at a full stop, question or exclamation mark of Chinese or Japanese', () => {
    expect(oneSentence('選んだボタンだけ黒になりました。他のボタンは元の色のままです。')).toBe(
      '選んだボタンだけ黒になりました。'
    )
    expect(oneSentence('按钮变黑了！其他按钮不变。')).toBe('按钮变黑了！')
    expect(oneSentence('これでいいですか？ 他は変えていません。')).toBe('これでいいですか？')
    expect(oneSentence('ボタンは黒です。')).toBe('ボタンは黒です。')
  })
})
