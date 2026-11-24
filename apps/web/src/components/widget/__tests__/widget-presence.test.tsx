// @vitest-environment happy-dom
/**
 * The widget's AnimatePresence stand-in: an element stays mounted through its
 * exit animation, leaves at once when there is nothing to animate, and stays
 * when it is shown again mid-exit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { HeightPresence, usePresence } from '../widget-presence'

function Fading({ show, exit }: { show: boolean; exit?: (el: HTMLElement) => Animation | null }) {
  const presence = usePresence<HTMLDivElement>(
    show,
    exit ?? ((el) => el.animate({ opacity: 0 }, { duration: 40, fill: 'forwards' }))
  )
  return presence.mounted ? <div ref={presence.ref}>bar</div> : null
}

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('usePresence', () => {
  it('keeps the element through its exit, then removes it', async () => {
    mockReducedMotion(false)
    const { rerender } = render(<Fading show />)
    rerender(<Fading show={false} />)
    expect(screen.getByText('bar')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('bar')).toBeNull())
  })

  it('removes the element at once when the exit returns no animation', () => {
    mockReducedMotion(false)
    const { rerender } = render(<Fading show exit={() => null} />)
    rerender(<Fading show={false} exit={() => null} />)
    expect(screen.queryByText('bar')).toBeNull()
  })

  it('removes the element at once under reduced motion', () => {
    mockReducedMotion(true)
    const exit = vi.fn((el: HTMLElement) => el.animate({ opacity: 0 }, { duration: 40 }))
    const { rerender } = render(<Fading show exit={exit} />)
    rerender(<Fading show={false} exit={exit} />)
    expect(screen.queryByText('bar')).toBeNull()
    expect(exit).not.toHaveBeenCalled()
  })

  it('keeps the same element when shown again mid-exit', async () => {
    mockReducedMotion(false)
    const { rerender } = render(<Fading show />)
    const el = screen.getByText('bar')
    rerender(<Fading show={false} />)
    rerender(<Fading show />)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(screen.getByText('bar')).toBe(el)
    // The exit was cancelled, so its filled end state doesn't hide the bar.
    expect(el.getAnimations()).toHaveLength(0)
  })
})

describe('HeightPresence', () => {
  it('shows the content it last had while it collapses', async () => {
    mockReducedMotion(false)
    const { rerender } = render(
      <HeightPresence show duration={40} easing="linear">
        <p>first</p>
      </HeightPresence>
    )
    rerender(
      <HeightPresence show={false} duration={40} easing="linear">
        <p>cleared</p>
      </HeightPresence>
    )
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.queryByText('cleared')).toBeNull()
    await waitFor(() => expect(screen.queryByText('first')).toBeNull())
  })
})
