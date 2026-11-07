/**
 * Quick find lists every part of the page shown, every page, and the
 * settings by name; a setting on a part another page has leads to that page,
 * and one on a part no page has is left out.
 */
import { describe, expect, it } from 'vitest'
import { blockFindActions, elementFindItems, quickFindItems } from '../quick-find'
import { newBlock } from '../home'
import { outlineOf } from '../outline'
import { defaultDesign } from '../schema'

const design = defaultDesign()

describe('quickFindItems', () => {
  it('lists the parts and pages, never the looks the styles set', () => {
    const items = quickFindItems(outlineOf(design, 'roadmap'), 'roadmap', ['feedback', 'roadmap'])
    const labels = items.map((item) => `${item.group}:${item.label}`)
    expect(labels).toContain('Blocks:Header and menu')
    expect(labels).toContain('Pages:Feedback')
    expect(labels).not.toContain('Blocks:Buttons')
  })

  it('leads a setting to its part, on a page that has it', () => {
    const items = quickFindItems(outlineOf(design, 'roadmap'), 'roadmap', ['feedback', 'roadmap'])
    expect(items.find((item) => item.label === 'Favicon')?.target).toEqual({
      kind: 'part',
      selection: 'site:brand',
      setting: 'Favicon',
    })
    expect(items.find((item) => item.label === 'Default sort')?.target).toEqual({
      kind: 'part',
      selection: 'feed',
      setting: 'Sort',
      page: 'feedback',
    })
  })

  it('has no setting that leads nowhere: Home’s layouts are an action', () => {
    const items = quickFindItems(outlineOf(design, 'home'), 'home', ['home', 'feedback'])
    expect(items.some((item) => item.label === 'Home layouts')).toBe(false)
    expect(
      items.filter(
        (item) =>
          item.group === 'Settings' &&
          item.target.kind === 'part' &&
          item.target.selection === 'home'
      )
    ).toEqual([])
  })
})

describe('Home blocks’ settings in quick find', () => {
  const home = () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = [
      { ...newBlock('ideas'), id: 'ideas0001' },
      { ...newBlock('status', { y: 1 }), id: 'status001' },
    ]
    return doc
  }

  it('come from the registry, each named for its block on Home', () => {
    const doc = home()
    const items = quickFindItems(outlineOf(doc, 'home'), 'home', ['home', 'feedback'], doc)
    const many = items.find(
      (item) => item.label === 'How many' && item.where === 'Top posts on Home'
    )
    expect(many?.target).toEqual({
      kind: 'part',
      selection: 'block-ideas0001',
      setting: 'How many',
    })
    expect(items.some((item) => item.label === 'Heading' && item.where === 'Status on Home')).toBe(
      true
    )
    expect(
      items.some((item) => item.label === 'Background' && item.where === 'Status on Home')
    ).toBe(true)
  })

  it('lead to Home from another page', () => {
    const doc = home()
    const items = quickFindItems(outlineOf(doc, 'feedback'), 'feedback', ['home', 'feedback'], doc)
    expect(
      items.find((item) => item.label === 'How many' && item.where === 'Top posts on Home')?.target
    ).toMatchObject({ page: 'home' })
  })

  it('show each block with its icon', () => {
    const doc = home()
    const items = quickFindItems(outlineOf(doc, 'home'), 'home', ['home'], doc)
    expect(items.find((item) => item.group === 'Blocks' && item.label === 'Top posts')?.icon).toBe(
      'ideas'
    )
  })
})

describe('actions in quick find', () => {
  const run = () => {}
  it('add a block and start Home from a layout, whatever is picked', () => {
    const labels = blockFindActions({ picked: null, onAdd: run, onLayouts: run }).map(
      (item) => item.label
    )
    expect(labels).toEqual(['Add a block…', 'Start Home from a layout…'])
  })

  it('duplicate and remove the picked block, by its name', () => {
    const items = blockFindActions({
      picked: 'Top posts',
      onAdd: run,
      onLayouts: run,
      onDuplicate: run,
      onRemove: run,
    })
    expect(items.map((item) => item.label)).toEqual([
      'Add a block…',
      'Duplicate Top posts',
      'Remove Top posts',
      'Start Home from a layout…',
    ])
    expect(items.every((item) => item.group === 'Actions' && item.target.kind === 'action')).toBe(
      true
    )
  })
})

describe('the hero’s settings in quick find', () => {
  it('lead to the hero, never to Theme', () => {
    const items = quickFindItems(outlineOf(design, 'roadmap'), 'roadmap', ['feedback', 'roadmap'])
    for (const name of ['Hero look', 'Hero image', 'Hero art', 'Hero height', 'Page titles'])
      expect(items.find((item) => item.label === name)?.target, name).toMatchObject({
        kind: 'part',
        selection: 'hero',
      })
    expect(items.find((item) => item.label === 'Hero look')?.target).toEqual({
      kind: 'part',
      selection: 'hero',
      setting: 'Look',
    })
    const hero = items.filter(
      (item) =>
        item.group === 'Settings' && item.target.kind === 'part' && item.target.selection === 'hero'
    )
    expect(hero.length).toBeGreaterThan(5)
    expect(hero.every((item) => item.where === 'Hero')).toBe(true)
  })

  it('takes the composer’s place to Home', () => {
    const items = quickFindItems(outlineOf(design, 'roadmap'), 'roadmap', [
      'home',
      'feedback',
      'roadmap',
    ])
    expect(items.find((item) => item.label === 'Composer on Home')?.target).toMatchObject({
      selection: 'hero',
      page: 'home',
    })
  })

  it('never names the band', () => {
    const items = quickFindItems(outlineOf(design, 'home'), 'home', ['home', 'feedback'])
    for (const item of items) expect(`${item.label} ${item.where ?? ''}`).not.toMatch(/\bband\b/i)
  })
})

describe('the picked element’s settings', () => {
  it('finds each of its fields by its label, under More or not, in place', () => {
    const items = elementFindItems('button', 'Call to action · Hero')
    expect(items.map((item) => item.label)).toContain('Edge width (px)')
    expect(items.map((item) => item.label)).toContain('Background')
    expect(items.find((item) => item.label === 'Edge width (px)')).toEqual({
      group: 'Settings',
      label: 'Edge width (px)',
      where: 'Call to action · Hero',
      terms: 'edge width',
      target: { kind: 'here', setting: 'Edge width (px)' },
    })
  })
})
