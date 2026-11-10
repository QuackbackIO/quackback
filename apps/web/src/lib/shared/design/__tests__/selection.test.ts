/**
 * One selection for the builder: a click on the page picks the block under
 * it and only that, a second click keeps it, empty canvas and Escape let it
 * go, and the panel, the chip and the AI share what is picked.
 */
import { describe, expect, it } from 'vitest'
import { canvasPickOf, NOTHING_PICKED, selectionReducer, type SelectionState } from '../selection'

const keys = ['site', 'site:brand', 'header', 'hero', 'home', 'block-aaaa', 'block-bbbb'] as const

describe('canvasPickOf', () => {
  it('picks blocks and page sections the outline lists', () => {
    expect(canvasPickOf('block-aaaa', keys)).toBe('block-aaaa')
    expect(canvasPickOf('header', keys)).toBe('header')
    expect(canvasPickOf('hero', keys)).toBe('hero')
  })

  it('picks nothing for what is not a block: the site, the blocks around them, the unlisted', () => {
    expect(canvasPickOf('site', keys)).toBeNull()
    expect(canvasPickOf('site:brand', keys)).toBeNull()
    expect(canvasPickOf('home', keys)).toBeNull()
    expect(canvasPickOf('footer', keys)).toBeNull()
    expect(canvasPickOf(null, keys)).toBeNull()
  })
})

describe('selectionReducer', () => {
  const picked = (state: SelectionState) => state.picked

  it('picks the block clicked, with the link under the click', () => {
    const state = selectionReducer(NOTHING_PICKED, {
      type: 'click',
      key: 'block-aaaa',
      href: '/posts/one',
    })
    expect(state).toMatchObject({ picked: 'block-aaaa', hovered: null, link: '/posts/one' })
  })

  it('keeps the block picked on a second click, never something inside it', () => {
    let state = selectionReducer(NOTHING_PICKED, { type: 'click', key: 'block-aaaa' })
    state = selectionReducer(state, { type: 'click', key: 'block-aaaa', href: null })
    expect(picked(state)).toBe('block-aaaa')
    expect(state.link).toBeNull()
  })

  it('lets go on a click on empty canvas, and on Escape', () => {
    let state = selectionReducer(NOTHING_PICKED, { type: 'click', key: 'block-aaaa' })
    state = selectionReducer(state, { type: 'click', key: null })
    expect(picked(state)).toBeNull()
    state = selectionReducer(state, { type: 'click', key: 'header' })
    state = selectionReducer(state, { type: 'escape' })
    expect(state).toEqual(NOTHING_PICKED)
  })

  it('takes a pick from the panel, which has no click and so no link', () => {
    let state = selectionReducer(NOTHING_PICKED, { type: 'click', key: 'block-aaaa', href: '/x' })
    state = selectionReducer(state, { type: 'pick', key: 'block-bbbb' })
    expect(state).toMatchObject({ picked: 'block-bbbb', hovered: null, link: null })
    state = selectionReducer(state, { type: 'pick', key: null })
    expect(picked(state)).toBeNull()
  })

  it('tracks what the pointer is over apart from what is picked', () => {
    let state = selectionReducer(NOTHING_PICKED, { type: 'hover', key: 'hero' })
    expect(state.hovered).toBe('hero')
    state = selectionReducer(state, { type: 'click', key: 'hero' })
    expect(state).toMatchObject({ picked: 'hero', hovered: 'hero' })
    state = selectionReducer(state, { type: 'hover', key: null })
    expect(state).toMatchObject({ picked: 'hero', hovered: null })
  })

  it('forgets the clicked link and the hover when the frame loads a page, keeping the pick', () => {
    let state = selectionReducer(NOTHING_PICKED, { type: 'click', key: 'hero', href: '/roadmap' })
    state = selectionReducer(state, { type: 'hover', key: 'hero' })
    state = selectionReducer(state, { type: 'reload' })
    expect(state).toMatchObject({ picked: 'hero', hovered: null, link: null })
    expect(selectionReducer(state, { type: 'reload' })).toBe(state)
  })

  it('keeps the very same state when nothing changes, so nothing draws again', () => {
    const state = selectionReducer(NOTHING_PICKED, { type: 'hover', key: 'hero' })
    expect(selectionReducer(state, { type: 'hover', key: 'hero' })).toBe(state)
    expect(selectionReducer(NOTHING_PICKED, { type: 'escape' })).toBe(NOTHING_PICKED)
  })
})

describe('picking an element in a block', () => {
  const vote = 'el:block-aaaa|vote||1'

  it('picks the element clicked and the block it is in', () => {
    const state = selectionReducer(NOTHING_PICKED, {
      type: 'click',
      key: 'block-aaaa',
      element: vote,
    })
    expect(state).toMatchObject({ picked: 'block-aaaa', element: vote })
  })

  it('steps up with Escape: the element to its block, the block to Blocks, then the page', () => {
    let state = selectionReducer(NOTHING_PICKED, {
      type: 'click',
      key: 'block-aaaa',
      element: vote,
    })
    state = selectionReducer(state, { type: 'escape' })
    expect(state).toMatchObject({ picked: 'block-aaaa', element: null })
    state = selectionReducer(state, { type: 'escape' })
    expect(state).toMatchObject({ picked: 'home', element: null })
    state = selectionReducer(state, { type: 'escape' })
    expect(state).toMatchObject({ picked: null, element: null })
  })

  it('steps up from a menu link to the header', () => {
    let state = selectionReducer(NOTHING_PICKED, { type: 'pick', key: 'link:docs' })
    state = selectionReducer(state, { type: 'escape' })
    expect(state.picked).toBe('header')
  })

  it('picks the block alone on its own box, and from the outline', () => {
    let state = selectionReducer(NOTHING_PICKED, {
      type: 'click',
      key: 'block-aaaa',
      element: vote,
    })
    state = selectionReducer(state, { type: 'click', key: 'block-aaaa' })
    expect(state.element).toBeNull()
    state = selectionReducer(state, { type: 'click', key: 'block-aaaa', element: vote })
    state = selectionReducer(state, { type: 'pick', key: 'block-bbbb' })
    expect(state).toMatchObject({ picked: 'block-bbbb', element: null })
  })

  it('goes down to an element and between elements, keeping the block', () => {
    let state = selectionReducer(NOTHING_PICKED, { type: 'pick', key: 'block-aaaa' })
    state = selectionReducer(state, { type: 'element', element: vote })
    expect(state).toMatchObject({ picked: 'block-aaaa', element: vote })
  })

  it('outlines the element under the pointer, and forgets it when the page loads afresh', () => {
    let state = selectionReducer(NOTHING_PICKED, {
      type: 'hover',
      key: 'block-aaaa',
      element: vote,
    })
    expect(state.hoveredElement).toBe(vote)
    state = selectionReducer(state, { type: 'click', key: 'block-aaaa', element: vote })
    state = selectionReducer(state, { type: 'reload' })
    expect(state).toMatchObject({ hoveredElement: null, element: vote })
  })
})
