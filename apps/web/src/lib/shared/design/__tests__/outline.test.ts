import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../schema'
import { newBlock } from '../home'
import {
  BLOCK_NAMES,
  designerPages,
  outlineKeys,
  outlineOf,
  pageOfPath,
  pagePath,
  locationOfPath,
} from '../outline'

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: false,
  support: false,
  status: false,
}

function withHome() {
  const design = defaultDesign()
  design.nav.home.on = true
  design.pages.home.blocks = [
    { ...newBlock('ideas'), id: 'ideas00001' },
    { ...newBlock('status'), id: 'status0001' },
  ]
  return design
}

/** A page's own parts, without the site's parts every page lists. */
const pageKeys = (...args: Parameters<typeof outlineOf>) =>
  outlineKeys(outlineOf(...args)).filter((key) => !key.startsWith('site:'))

describe('outlineOf', () => {
  it("lists Home's blocks, in order, under the hero", () => {
    expect(pageKeys(withHome(), 'home')).toEqual([
      'site',
      'header',
      'logo',
      'hero',
      'home',
      'block-ideas00001',
      'block-status0001',
    ])
  })

  it('names blocks as posts, or by their heading in any language', () => {
    const design = withHome()
    expect(outlineOf(design, 'home')[3]!.children![0]!.label).toBe('Top posts')
    expect(BLOCK_NAMES.composer).toBe('Write a post')
    design.pages.home.blocks[1]!.heading = { de: 'Lage' }
    expect(outlineOf(design, 'home')[3]!.children![1]!.label).toBe('Lage')
  })

  it('gives each block its type, named too where its heading differs', () => {
    const design = withHome()
    design.pages.home.blocks[1]!.heading = { en: 'Top asks' }
    const [ideas, status] = outlineOf(design, 'home')[3]!.children!
    expect(ideas).toMatchObject({ blockType: 'ideas', label: 'Top posts' })
    expect(ideas!.typeName).toBeUndefined()
    expect(status).toMatchObject({ blockType: 'status', label: 'Top asks', typeName: 'Status' })
  })

  it('lists the welcome message when off too, so it can be turned back on', () => {
    const design = defaultDesign()
    const welcome = () => outlineOf(design, 'feedback').find((node) => node.key === 'welcome')
    expect(pageKeys(design, 'feedback')).toEqual([
      'site',
      'header',
      'logo',
      'hero',
      'welcome',
      'feed',
      'filters',
    ])
    expect(welcome()?.label).toBe('Welcome (off)')
    design.pages.feedback.welcome.show = true
    expect(welcome()?.label).toBe('Welcome message')
  })

  it('gives the other pages their hero and their own sections, and Status none', () => {
    expect(pageKeys(defaultDesign(), 'roadmap')).toEqual([
      'site',
      'header',
      'logo',
      'hero',
      'board',
    ])
    expect(pageKeys(defaultDesign(), 'status')).toEqual(['site', 'header', 'logo'])
    expect(pageKeys(defaultDesign(), 'post')).toEqual(['site', 'header', 'logo'])
  })

  it('names the hero Hero on every page that has one', () => {
    for (const page of ['home', 'feedback', 'roadmap', 'changelog', 'help', 'support'] as const)
      expect(outlineOf(withHome(), page).find((node) => node.key === 'hero')?.label).toBe('Hero')
  })
})

describe('pages', () => {
  it('offers Home while it is on, then the pages the workspace has', () => {
    expect(designerPages(withHome(), gates)).toEqual([
      'home',
      'feedback',
      'post',
      'roadmap',
      'changelog',
    ])
    expect(designerPages(defaultDesign(), { ...gates, feedback: false, roadmap: false })).toEqual([
      'changelog',
    ])
  })

  it('reads the page a path shows, a post under its page', () => {
    expect(pageOfPath('/', true)).toBe('home')
    expect(pageOfPath('/', false)).toBe('feedback')
    expect(pageOfPath('/hc/articles/x', false)).toBe('help')
    expect(pageOfPath('/roadmap/', false)).toBe('roadmap')
    expect(pageOfPath('/b/ideas/posts/1', false)).toBe('post')
    expect(pageOfPath('/b/ideas', false)).toBeNull()
    expect(pagePath('post', '/b/ideas/posts/1')).toBe('/b/ideas/posts/1')
    expect(pageKeys(defaultDesign(), 'post')).toEqual(['site', 'header', 'logo'])
    expect(pagePath('home')).toBe('/')
    expect(pagePath('help')).toBe('/hc')
  })

  it('keeps a detail page as the item its page shows', () => {
    expect(locationOfPath('/b/ideas/posts/1?x=1', false)).toEqual({
      page: 'post',
      item: '/b/ideas/posts/1',
    })
    expect(locationOfPath('/changelog/entry_1', false)).toEqual({
      page: 'changelog',
      item: '/changelog/entry_1',
    })
    expect(locationOfPath('/hc/articles/getting-started/12-invite', false)).toEqual({
      page: 'help',
      item: '/hc/articles/getting-started/12-invite',
    })
    expect(locationOfPath('/status/incident_1/', false)).toEqual({
      page: 'status',
      item: '/status/incident_1',
    })
    expect(locationOfPath('/changelog', false)).toEqual({ page: 'changelog', item: null })
    expect(locationOfPath('/', true)).toEqual({ page: 'home', item: null })
    // Pages the designer does not draw yet.
    expect(locationOfPath('/settings/profile', false)).toBeNull()
    expect(locationOfPath('/design-sample/status', false)).toBeNull()
    expect(pagePath('changelog', '/changelog/entry_1')).toBe('/changelog/entry_1')
  })
})

describe('the header', () => {
  it('holds the logo, its own element, on every page', () => {
    for (const page of ['home', 'feedback', 'roadmap', 'status', 'post'] as const) {
      const header = outlineOf(defaultDesign(), page).find((node) => node.key === 'header')!
      expect(header.children).toEqual([{ key: 'logo', label: 'Logo' }])
    }
  })
})

describe('looks are not in the outline', () => {
  it('lists blocks and sections only, never the elements the styles set', () => {
    for (const page of ['home', 'feedback', 'roadmap', 'status', 'post'] as const) {
      const keys = outlineKeys(outlineOf(defaultDesign(), page))
      expect(keys).not.toContain('elements')
      expect(keys.filter((key) => key.startsWith('el:'))).toEqual([])
    }
  })
})

describe('what every page shares, in the outline', () => {
  it('lists the words; the brand kit, styles and readability are in Theme', () => {
    const site = outlineOf(defaultDesign(), 'feedback')[0]!
    expect(site).toMatchObject({ key: 'site', label: 'Every page' })
    expect(site.children?.map((node) => [node.key, node.label])).toEqual([['site:words', 'Words']])
  })
})
