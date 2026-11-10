// @vitest-environment happy-dom
/**
 * What the builder has picked: a click on the page picks the block under it
 * and says so, a second click keeps it, empty canvas and Escape let it go,
 * and the brand kit and styles open their panels instead.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { outlineOf, type OutlineNode } from '@/lib/shared/design/outline'
import { defaultDesign } from '@/lib/shared/design/schema'
import { nodeLabel, useCanvasSelection } from '../use-canvas-selection'

const design = defaultDesign()

const nodes = [
  { key: 'header', label: 'Header' },
  { key: 'home', label: 'Blocks', children: [{ key: 'block-aaaaaaaa', label: 'Welcome' }] },
] as unknown as OutlineNode[]

function picking() {
  const onPanel = vi.fn()
  const onPicked = vi.fn()
  const say = vi.fn()
  const hook = renderHook(() =>
    useCanvasSelection({ nodes, design, page: 'home', onPanel, onPicked, say })
  )
  return { ...hook, onPanel, onPicked, say }
}

describe('useCanvasSelection', () => {
  it('picks the logo, its own element in the header, and Escape goes up to the header', () => {
    const real = outlineOf(defaultDesign(), 'roadmap')
    const hook = renderHook(() =>
      useCanvasSelection({
        nodes: real,
        design,
        page: 'roadmap',
        onPanel: vi.fn(),
        onPicked: vi.fn(),
        say: vi.fn(),
      })
    )
    act(() => hook.result.current.select('logo', null))
    expect(hook.result.current.selection).toBe('logo')
    expect(hook.result.current.nameOf('logo')).toBe('Logo')
    act(() => hook.result.current.stepBack())
    expect(hook.result.current.selection).toBe('header')
  })

  it('names parts and their children from the outline', () => {
    expect(nodeLabel(nodes, 'block-aaaaaaaa')).toBe('Welcome')
    expect(nodeLabel(nodes, null)).toBeUndefined()
  })

  it('picks the block clicked, says so, and keeps it on a second click', () => {
    const { result, onPicked, say } = picking()
    act(() => result.current.select('block-aaaaaaaa', '/b/ideas/posts/p1'))
    expect(result.current.selection).toBe('block-aaaaaaaa')
    expect(result.current.link).toBe('/b/ideas/posts/p1')
    expect(onPicked).toHaveBeenCalledOnce()
    expect(say).toHaveBeenCalledWith('Welcome selected. Its settings are on the right.')
    act(() => result.current.select('block-aaaaaaaa', null))
    expect(result.current.selection).toBe('block-aaaaaaaa')
    expect(result.current.link).toBeNull()
  })

  it('lets go on empty canvas, on the space around the blocks, and on Escape', () => {
    const { result } = picking()
    act(() => result.current.select('header', null))
    act(() => result.current.select(null, null))
    expect(result.current.selection).toBeNull()
    act(() => result.current.select('header', null))
    act(() => result.current.select('home', null))
    expect(result.current.selection).toBeNull()
    act(() => result.current.select('header', null))
    act(() => result.current.stepBack())
    expect(result.current.selection).toBeNull()
  })

  it('forgets the link under the last click and the hover when the page changes or reloads', () => {
    const onPanel = vi.fn()
    const hook = renderHook(
      ({ page }: { page: string }) =>
        useCanvasSelection({ nodes, design, page, onPanel, onPicked: vi.fn(), say: vi.fn() }),
      { initialProps: { page: 'home' } }
    )
    act(() => hook.result.current.select('block-aaaaaaaa', '/roadmap'))
    act(() => hook.result.current.hover('block-aaaaaaaa'))
    hook.rerender({ page: 'feedback' })
    expect(hook.result.current.link).toBeNull()
    expect(hook.result.current.hovered).toBeNull()
    act(() => hook.result.current.select('block-aaaaaaaa', '/roadmap'))
    act(() => hook.result.current.hover('block-aaaaaaaa'))
    act(() => hook.result.current.reload())
    expect(hook.result.current.link).toBeNull()
    expect(hook.result.current.hovered).toBeNull()
    expect(hook.result.current.selection).toBe('block-aaaaaaaa')
  })

  it('shows on hover only what a click would pick', () => {
    const { result } = picking()
    act(() => result.current.hover('block-aaaaaaaa'))
    expect(result.current.hovered).toBe('block-aaaaaaaa')
    act(() => result.current.hover('footer'))
    expect(result.current.hovered).toBeNull()
  })

  it('opens the brand kit and styles in their panels, and forgets a pick the page lost', () => {
    const { result, onPanel } = picking()
    act(() => result.current.pick('site:brand'))
    expect(onPanel).toHaveBeenCalledWith('brand')
    expect(result.current.selection).toBeNull()
    act(() => result.current.pick('block-gone0000' as never))
    expect(result.current.selection).toBeNull()
    act(() => result.current.pick('block-aaaaaaaa' as never))
    expect(result.current.selection).toBe('block-aaaaaaaa')
  })

  it('picks the element under a click and its block, names it, and steps back up to the block', () => {
    document.body.innerHTML = `<div data-qb-page="home"><section data-qb-section="block-aaaaaaaa"><a id="more" data-qb-link="" href="/">All</a></section></div>`
    const { result, say } = picking()
    act(() => result.current.select('block-aaaaaaaa', null, document.getElementById('more')))
    expect(result.current.selection).toBe('block-aaaaaaaa')
    expect(result.current.element).toEqual({
      element: 'link',
      part: null,
      section: 'block-aaaaaaaa',
      index: 0,
    })
    expect(say).toHaveBeenLastCalledWith('Link selected. Its settings are on the right.')
    act(() => result.current.stepBack())
    expect(result.current.selection).toBe('block-aaaaaaaa')
    expect(result.current.element).toBeNull()
    // Escape keeps climbing a level at a time: the block's Blocks, then the page.
    act(() => result.current.stepBack())
    expect(result.current.selection).toBe('home')
    act(() => result.current.stepBack())
    expect(result.current.selection).toBeNull()
  })

  it('hands over the same picked element on every render until another is picked', () => {
    document.body.innerHTML = `<div data-qb-page="home"><section data-qb-section="block-aaaaaaaa"><a id="more" data-qb-link="" href="/">All</a></section></div>`
    const { result, rerender } = picking()
    act(() => result.current.select('block-aaaaaaaa', null, document.getElementById('more')))
    const picked = result.current.element
    expect(picked).not.toBeNull()
    rerender()
    act(() => result.current.hover('block-aaaaaaaa', null))
    expect(result.current.element).toBe(picked)
  })
})
