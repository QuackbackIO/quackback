// @vitest-environment happy-dom
/**
 * Ask AI's pane on the left: open at its width, or a thin rail whose button
 * opens it; its edge resizes by the arrow keys within 300 to 480, and the
 * pane remembers how it was left, per person.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => ({ user: { id: 'user_1' } }),
}))

const { AiPane, AI_RAIL_WIDTH, paneTransition } = await import('../ai-pane')
const { aiPaneKey, useAiPane } = await import('../use-ai-pane')

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function pane(over: Partial<Parameters<typeof AiPane>[0]['pane']> = {}) {
  return {
    collapsed: false,
    width: 360,
    resizing: false,
    expand: vi.fn(),
    reveal: vi.fn(),
    collapse: vi.fn(),
    resize: vi.fn(),
    setResizing: vi.fn(),
    ...over,
  }
}

function show(state: ReturnType<typeof pane>, viewport = 1440) {
  render(
    <TooltipProvider>
      <AiPane pane={state} hidden={false} viewport={viewport}>
        <p>The chat</p>
      </AiPane>
    </TooltipProvider>
  )
}

describe('AiPane', () => {
  it('holds the chat when open, with an edge to resize it', () => {
    show(pane())
    expect(screen.getByText('The chat')).toBeTruthy()
    const edge = screen.getByRole('separator', { name: 'Resize Ask AI' })
    expect(edge.getAttribute('aria-valuenow')).toBe('360')
    expect(edge.getAttribute('aria-valuemin')).toBe('300')
    expect(edge.getAttribute('aria-valuemax')).toBe('480')
  })

  it('resizes by the arrow keys', () => {
    const state = pane()
    show(state)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    expect(state.resize).toHaveBeenCalledWith(376)
  })

  it('is a rail with Ask AI on it when collapsed, which opens it', () => {
    const state = pane({ collapsed: true })
    show(state)
    expect(screen.queryByText('The chat')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
    expect(state.expand).toHaveBeenCalledOnce()
    expect(AI_RAIL_WIDTH).toBeLessThan(60)
  })

  it('narrows to keep the canvas its floor beside the properties', () => {
    show(pane({ width: 480 }), 1280)
    const aside = screen.getByRole('complementary', { name: 'Ask AI' })
    expect(parseInt(aside.style.width)).toBeLessThanOrEqual(1280 - 340 - 640)
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
      aside.style.width.replace('px', '')
    )
  })

  it('lies over the canvas from its rail when it cannot fit, and the rail closes it', () => {
    const state = pane({ width: 360 })
    show(state, 1100)
    const aside = screen.getByRole('complementary', { name: 'Ask AI' })
    expect(aside.style.width).toBe(`${AI_RAIL_WIDTH}px`)
    const over = document.querySelector<HTMLElement>('[data-ai-pane-overlay]')!
    expect(over.style.width).toBe('360px')
    expect(over.textContent).toContain('The chat')
    const button = screen.getByRole('button', { name: 'Ask AI' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(state.collapse).toHaveBeenCalledOnce()
  })

  it('shows the chat in a one-column window even when collapsed, never a bare rail', () => {
    show(pane({ collapsed: true }), 900)
    expect(screen.getByText('The chat')).toBeTruthy()
  })

  it('follows the pointer without easing while dragged, and moves at once for less motion', () => {
    expect(paneTransition(true)).toEqual({ duration: 0 })
    expect((paneTransition(false) as { duration: number }).duration).toBeLessThanOrEqual(0.2)
    expect(paneTransition(false, true)).toEqual({ duration: 0 })
  })
})

describe('useAiPane', () => {
  it('remembers collapsing and the width, for the person signed in', () => {
    const { result } = renderHook(() => useAiPane(false))
    act(() => result.current.collapse())
    expect(JSON.parse(localStorage.getItem(aiPaneKey('user_1'))!)).toEqual({
      collapsed: true,
      width: 360,
      chosen: true,
    })
    act(() => result.current.resize(420))
    expect(JSON.parse(localStorage.getItem(aiPaneKey('user_1'))!).width).toBe(420)
  })

  it('opens as it was left', () => {
    localStorage.setItem(aiPaneKey('user_1'), JSON.stringify({ collapsed: true, width: 400 }))
    const { result } = renderHook(() => useAiPane(false))
    expect(result.current.collapsed).toBe(true)
    expect(result.current.width).toBe(400)
  })

  it('opens on "/" outside a field, and not while previewing', () => {
    localStorage.setItem(aiPaneKey('user_1'), JSON.stringify({ collapsed: true }))
    const onShow = vi.fn()
    const { result, rerender } = renderHook(({ previewing }) => useAiPane(previewing, onShow), {
      initialProps: { previewing: true },
    })
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' })))
    expect(result.current.collapsed).toBe(true)
    rerender({ previewing: false })
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' })))
    expect(result.current.collapsed).toBe(false)
    expect(onShow).toHaveBeenCalledOnce()
  })

  it('starts collapsed once a brand match has run, giving the canvas the room', () => {
    const { result } = renderHook(() => useAiPane(false, undefined, true))
    expect(result.current.collapsed).toBe(true)
    // A match shown in the pane opens it for now, but is not a choice to keep it open.
    act(() => result.current.reveal())
    expect(result.current.collapsed).toBe(false)
    cleanup()
    expect(renderHook(() => useAiPane(false, undefined, true)).result.current.collapsed).toBe(true)
  })

  it('keeps it open once opened by hand, though a match has run', () => {
    const first = renderHook(() => useAiPane(false, undefined, true))
    act(() => first.result.current.expand())
    first.unmount()
    expect(renderHook(() => useAiPane(false, undefined, true)).result.current.collapsed).toBe(false)
  })

  it('does not remember a width mid-drag', () => {
    const { result } = renderHook(() => useAiPane(false))
    act(() => result.current.resize(440, false))
    expect(result.current.width).toBe(440)
    expect(localStorage.getItem(aiPaneKey('user_1'))).toBeNull()
  })
})
