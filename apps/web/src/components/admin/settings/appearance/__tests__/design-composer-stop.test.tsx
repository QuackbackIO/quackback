// @vitest-environment happy-dom
/**
 * While a request runs, Stop takes Send's place: the same button, reached
 * the same way, and Escape anywhere in the composer stops too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/client/image-palette', () => ({ imagePalette: async () => [] }))
vi.mock('@/lib/client/brand-shots', () => ({ readBrandShot: async () => null }))
vi.mock('@/lib/server/functions/portal-design-ai', () => ({ readBrandShotsFn: vi.fn() }))

const { DesignComposer } = await import('../design-composer')

afterEach(cleanup)

const composer = (busy: boolean, onStop = vi.fn(), onAsk = vi.fn()) => {
  const view = render(
    <DesignComposer
      scope="site"
      busy={busy}
      onClearScope={() => {}}
      onAsk={onAsk}
      onStop={onStop}
    />
  )
  return { onStop, onAsk, view }
}

describe('Stop in the composer', () => {
  it('takes Send’s place while a request runs, and stops it', () => {
    const { onStop } = composer(true)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement
    expect(stop.disabled).toBe(false)
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('is the same button as Send, so focus stays on it', () => {
    const { view, onStop } = composer(false)
    const send = screen.getByRole('button', { name: 'Send' })
    view.rerender(
      <DesignComposer scope="site" busy onClearScope={() => {}} onAsk={vi.fn()} onStop={onStop} />
    )
    expect(screen.getByRole('button', { name: 'Stop' })).toBe(send)
  })

  it('stops on Escape from the box, and the Escape goes no further', () => {
    const { onStop } = composer(true)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    screen.getByLabelText('Ask Quackback AI').dispatchEvent(event)
    expect(onStop).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves Escape alone when nothing runs', () => {
    const { onStop } = composer(false)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    screen.getByLabelText('Ask Quackback AI').dispatchEvent(event)
    expect(onStop).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('shows Send while nothing runs, and never sends while a request runs', () => {
    const { onAsk } = composer(true)
    const box = screen.getByLabelText('Ask Quackback AI')
    fireEvent.change(box, { target: { value: 'Warmer' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onAsk).not.toHaveBeenCalled()
  })
})
