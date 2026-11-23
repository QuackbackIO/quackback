// @vitest-environment happy-dom
/**
 * When the preview outlines a change: at once for a chat request or an
 * import, once a hand edit has settled (not on every drag frame, not while
 * typing), and never for undo.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftFromLoaded, editTheme, type PortalDraft } from '../portal-draft'
import { applyDraftPatch } from '../ask-draft'
import { HAND_SETTLE_MS, useChangeFlash } from '../use-change-flash'

const base = draftFromLoaded({
  theme: { themeMode: 'light', light: { primary: '#15803d', radius: '0.5rem' } },
  customCss: '',
  portal: {
    nav: {
      items: [
        { id: 'feedback', type: 'feedback' },
        { id: 'roadmap', type: 'roadmap' },
      ],
    },
  } as never,
  helpCenter: null,
})
const navy = (d: PortalDraft) => editTheme.setColour(d, 'header', 'light', '#0b1f3a')

const setup = () =>
  renderHook(({ draft }: { draft: PortalDraft }) => useChangeFlash(draft), {
    initialProps: { draft: base },
  })
const settle = () => act(() => vi.advanceTimersByTime(HAND_SETTLE_MS + 400))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useChangeFlash', () => {
  it('outlines nothing to begin with', () => {
    expect(setup().result.current.flash).toBeNull()
  })

  it('outlines a chat or import change at once', () => {
    const { result, rerender } = setup()
    act(() => result.current.flashNow())
    rerender({
      draft: applyDraftPatch(base, { colours: { light: { header: '#0b1f3a' } }, corners: 0 }),
    })
    expect(result.current.flash).toEqual({ targets: ['header', 'colours'] })
  })

  it('outlines a hand edit once it has settled, the whole drag as one', () => {
    const { result, rerender } = setup()
    let draft = base
    for (const hex of ['#111111', '#222244', '#0b1f3a']) {
      draft = editTheme.setColour(draft, 'header', 'light', hex)
      rerender({ draft })
      act(() => vi.advanceTimersByTime(100))
      expect(result.current.flash).toBeNull()
    }
    settle()
    expect(result.current.flash).toEqual({ targets: ['header'] })
  })

  it('waits for the pointer to lift', () => {
    const { result, rerender } = setup()
    act(() => void window.dispatchEvent(new Event('pointerdown')))
    rerender({ draft: navy(base) })
    settle()
    settle()
    expect(result.current.flash).toBeNull()
    act(() => void window.dispatchEvent(new Event('pointerup')))
    settle()
    expect(result.current.flash).toEqual({ targets: ['header'] })
  })

  it('waits for typing to end', () => {
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    const { result, rerender } = setup()
    rerender({ draft: applyDraftPatch(base, { welcomeMessage: 'Hi' }) })
    settle()
    expect(result.current.flash).toBeNull()
    act(() => field.blur())
    settle()
    expect(result.current.flash).toEqual({ targets: ['welcome'] })
  })

  it('outlines nothing for undo, and measures the next edit from there', () => {
    const { result, rerender } = setup()
    act(() => result.current.flashNow())
    rerender({ draft: navy(base) })
    const first = result.current.flash
    act(() => result.current.quietly())
    rerender({ draft: base })
    settle()
    expect(result.current.flash).toBe(first)
    rerender({ draft: editTheme.setRadius(base, 0) })
    settle()
    expect(result.current.flash).toEqual({ targets: ['colours'] })
  })

  it('outlines nothing for a broad change, or for more than three parts', () => {
    const { result, rerender } = setup()
    act(() => result.current.flashNow())
    rerender({ draft: applyDraftPatch(base, { font: 'lora' }) })
    expect(result.current.flash).toBeNull()
    act(() => result.current.flashNow())
    rerender({
      draft: applyDraftPatch(base, {
        colours: { light: { header: '#0b1f3a', main: '#ea580c' } },
        tabs: { order: ['roadmap'] },
        welcomeMessage: 'Hi there!',
      }),
    })
    expect(result.current.flash).toBeNull()
  })
})
