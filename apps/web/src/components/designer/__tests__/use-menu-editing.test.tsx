// @vitest-environment happy-dom
/**
 * The menu edited on the page: a click opens an item's menu and a second
 * click hands it the keyboard again, a click elsewhere or Escape closes it,
 * and every change reaches the draft as a named step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { defaultDesign } from '@/lib/shared/design/schema'
import { useMenuEditing } from '../use-menu-editing'

vi.mock('@/lib/client/builder-events', () => ({ trackBuilder: vi.fn() }))

afterEach(cleanup)

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: false,
  support: false,
  status: false,
}

function show() {
  const design = defaultDesign()
  design.nav.home = { on: true, tab: true }
  const props = {
    design,
    gates,
    update: vi.fn(),
    page: 'home' as const,
    setPage: vi.fn(),
    pick: vi.fn(),
    say: vi.fn(),
  }
  const { result } = renderHook(() => useMenuEditing(props))
  return { result, ...props }
}

describe('useMenuEditing', () => {
  it('opens an item’s menu on a click, and again for the keyboard on a second', () => {
    const { result } = show()
    act(() => result.current.onMenu('roadmap', 'click'))
    expect(result.current.open).toEqual({ target: 'roadmap', mode: 'menu', seq: 0 })
    expect(result.current.menu?.entries[0]?.label).toBe('Go to Roadmap')
    act(() => result.current.onMenu('roadmap', 'click'))
    expect(result.current.open?.seq).toBe(1)
    act(() => result.current.onMenu('roadmap', 'rename'))
    expect(result.current.open?.mode).toBe('rename')
  })

  it('closes the menu on a click elsewhere, saying whether one was open', () => {
    const { result } = show()
    let was = true
    act(() => void (was = result.current.dismiss()))
    expect(was).toBe(false)
    act(() => result.current.onMenu('feedback', 'click'))
    act(() => void (was = result.current.dismiss()))
    expect(was).toBe(true)
    expect(result.current.open).toBeNull()
  })

  it('goes to the page, and makes each change a named step', () => {
    const { result, setPage, update } = show()
    act(() => result.current.act('roadmap', 'go'))
    expect(setPage).toHaveBeenCalledWith('roadmap', null)
    act(() => result.current.act('roadmap', 'hide'))
    expect(update).toHaveBeenCalledWith(expect.any(Function), 'Hide Roadmap')
    act(() => result.current.rename('changelog', 'News'))
    expect(update).toHaveBeenCalledWith(expect.any(Function), 'Rename Changelog to News')
    act(() => result.current.land('roadmap'))
    expect(update).toHaveBeenLastCalledWith(expect.any(Function), 'Roadmap as the landing page')
  })

  it('leads Edit link to the link’s settings', () => {
    const { result, pick } = show()
    act(() => result.current.act('link:abc', 'edit-link'))
    expect(pick).toHaveBeenCalledWith('link:abc')
  })
})
