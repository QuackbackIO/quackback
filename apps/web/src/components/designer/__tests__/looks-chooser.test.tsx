// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * Compare looks shows the brand's three looks as live Home pages, side by
 * side or one at a time. Picking a look only shows it; Use takes it into the
 * draft as one step, with Undo in a toast, keeping the draft's own menu and
 * words. The frames load once: switching looks, views, devices or zoom moves
 * and scales them, never loads them again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { lookVariants } from '@/lib/shared/design/look-variants'
import { lookFrameSize, withVariant } from '@/lib/shared/design/compare-looks'
import { canvasScale } from '../designer-canvas'
import { installInMemoryLocalStorage } from '@/test/local-storage'

const toast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))
const events = vi.hoisted(() => ({ trackBuilder: vi.fn(), designerLookChosen: vi.fn() }))
vi.mock('@/lib/client/builder-events', () => events)

installInMemoryLocalStorage()

const { LooksChooser } = await import('../looks-chooser')
const { LOOKS_KIT } = await import('../looks-kit')
const { rememberMatch } = await import('../looks-entry')

let draft: PortalDesign
let labels: Array<string | undefined>
const onClose = vi.fn()
const undoStep = vi.fn((_label: string) => true)
const record = vi.fn()

/** The chooser over a device held in state, as the canvas holds it. */
function Harness(props: Partial<Parameters<typeof LooksChooser>[0]>) {
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop')
  return (
    <LooksChooser
      kit={LOOKS_KIT}
      design={draft}
      from="theme"
      device={device}
      onDevice={setDevice}
      theme="light"
      locale="en"
      update={(change, label) => {
        const next = structuredClone(draft)
        change(next)
        labels.push(label)
        draft = next
      }}
      undoStep={undoStep}
      record={record}
      onClose={onClose}
      {...props}
    />
  )
}

const mount = (props: Partial<Parameters<typeof LooksChooser>[0]> = {}) =>
  render(<Harness {...props} />)

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) })
const frames = () => [...document.querySelectorAll('iframe')]

beforeEach(() => {
  draft = defaultDesign()
  labels = []
  localStorage.clear()
  vi.clearAllMocks()
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
})
afterEach(cleanup)

describe('LooksChooser', () => {
  it('opens side by side on Matched, in use, with nothing to take', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Pick a look' })).toBeTruthy()
    expect(radio('Matched').getAttribute('aria-checked')).toBe('true')
    expect(radio('Matched').textContent).toContain('In use')
    expect(screen.getByRole('radio', { name: 'Side by side' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    const use = screen.getByRole('button', { name: 'In use' })
    expect((use as HTMLButtonElement).disabled).toBe(true)
    // Zoom is for one look at a time; side by side always fits.
    expect(screen.queryByRole('radiogroup', { name: 'Zoom' })).toBeNull()
    expect(frames()).toHaveLength(3)
  })

  it('takes the picked look as one step, keeps the menu, says so in a toast with Undo, and closes', () => {
    draft.nav.home.on = !draft.nav.home.on
    const menu = draft.nav.home.on
    const expected = withVariant(draft, lookVariants(draft)[1]!)
    mount()
    fireEvent.click(radio('Soft'))
    // Picking only shows it.
    expect(labels).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Use Soft' }))
    expect(labels).toEqual(['Soft look'])
    expect(draft).toEqual(expected)
    expect(draft.nav.home.on).toBe(menu)
    expect(events.designerLookChosen).toHaveBeenCalledWith('compare')
    expect(events.trackBuilder).toHaveBeenCalledWith('designer_looks_applied', { look: 'soft' })
    expect(toast).toHaveBeenCalledWith('Soft look applied', expect.anything())
    expect(onClose).toHaveBeenCalledTimes(1)
    // Opened from Theme, Ask AI says nothing.
    expect(record).not.toHaveBeenCalled()
    // The toast's Undo takes the step back, by its name.
    const { action } = toast.mock.calls[0]![1] as { action: { onClick: () => void } }
    action.onClick()
    expect(undoStep).toHaveBeenCalledWith('Soft look')
    expect(events.trackBuilder).toHaveBeenCalledWith('designer_looks_undone', { look: 'soft' })
  })

  it('counts no undo when the look is no longer the last step', () => {
    undoStep.mockReturnValueOnce(false)
    mount()
    fireEvent.click(radio('Vivid'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Vivid' }))
    ;(toast.mock.calls[0]![1] as { action: { onClick: () => void } }).action.onClick()
    expect(events.trackBuilder).not.toHaveBeenCalledWith('designer_looks_undone', expect.anything())
  })

  it('says in Ask AI what it switched to, opened from there, with the step’s changes for its Undo', () => {
    mount({ from: 'ai' })
    fireEvent.click(radio('Vivid'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Vivid' }))
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        text: 'Switched to Vivid. Kept your headline and menu.',
        looks: true,
      })
    )
    const turn = record.mock.calls[0]![0] as { changes: Array<{ path: string }> }
    expect(turn.changes.length).toBeGreaterThan(0)
  })

  it('makes its looks from the brand match kept, not from the draft edited since', () => {
    const matched = defaultDesign()
    matched.brand.matchedAt = '2026-11-01T00:00:00.000Z'
    rememberMatch(matched)
    draft = structuredClone(matched)
    // Edited since the match: Matched puts the match's look back.
    draft.shape.corners = draft.shape.corners === 'sharp' ? 'pill' : 'sharp'
    mount()
    expect(screen.getByRole('button', { name: 'Use Matched' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use Matched' }))
    expect(draft.shape.corners).toBe(matched.shape.corners)
  })

  it('View larger shows that look one at a time, where the arrows switch looks and zoom applies', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /^View larger\W+Vivid$/ }))
    expect(screen.getByRole('radio', { name: 'One at a time' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    const looks = screen.getByRole('radiogroup', { name: 'Looks' })
    const vivid = within(looks).getByRole('radio', { name: 'Vivid' })
    expect(vivid.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(vivid)
    fireEvent.keyDown(vivid, { key: 'ArrowRight' })
    expect(within(looks).getByRole('radio', { name: 'Matched' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(screen.getByRole('radiogroup', { name: 'Zoom' })).toBeTruthy()
    // Only the picked look's card shows.
    const shown = [...document.querySelectorAll('[data-look-card]')].filter(
      (card) => !card.classList.contains('invisible')
    )
    expect(shown.map((card) => card.getAttribute('data-look-card'))).toEqual(['matched'])
  })

  it('keeps its frames: looks, views, devices and zoom never load a page again', () => {
    mount()
    const before = frames()
    const srcs = before.map((frame) => frame.getAttribute('src'))
    fireEvent.click(radio('Soft'))
    fireEvent.click(screen.getByRole('radio', { name: 'One at a time' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Phone' }))
    fireEvent.click(screen.getByRole('radio', { name: '50%' }))
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Looks' })).getByRole('radio', {
        name: 'Vivid',
      })
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Side by side' }))
    const after = frames()
    expect(after).toHaveLength(3)
    after.forEach((frame, index) => expect(frame).toBe(before[index]))
    expect(after.map((frame) => frame.getAttribute('src'))).toEqual(srcs)
    // The phone is laid out at its own width.
    expect(after[0]!.style.width).toBe('390px')
  })

  it('remembers its own zoom between openings', () => {
    mount()
    fireEvent.click(screen.getByRole('radio', { name: 'One at a time' }))
    fireEvent.click(screen.getByRole('radio', { name: '75%' }))
    cleanup()
    mount()
    fireEvent.click(screen.getByRole('radio', { name: 'One at a time' }))
    expect(screen.getByRole('radio', { name: '75%' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Fit to the window' }))
  })

  it('counts a change of view', () => {
    mount()
    fireEvent.click(screen.getByRole('radio', { name: 'One at a time' }))
    expect(events.trackBuilder).toHaveBeenCalledWith('designer_looks_view_changed', { view: 'one' })
  })

  it('in a narrow window shows one look at a time, with no side by side to choose', () => {
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
    mount()
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Looks' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'Zoom' })).toBeTruthy()
  })

  it('closes on Escape and Not now, and the builder’s own keys stay out', () => {
    const outside = vi.fn()
    render(
      // The builder's own keys, such as Delete for a picked block, are an ancestor's.
      <div onKeyDown={outside}>
        <Harness />
      </div>
    )
    fireEvent.keyDown(radio('Matched'), { key: 'Delete' })
    expect(outside).not.toHaveBeenCalled()
    fireEvent.keyDown(radio('Matched'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('picks a look clicked on its page', () => {
    mount()
    const vivid = frames()[2]!
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: vivid.contentWindow,
          data: { type: 'quackback:preview-section', section: 'hero' },
        })
      )
    })
    expect(radio('Vivid').getAttribute('aria-checked')).toBe('true')
  })

  it('scrolls the looks together, so each shows the same part of the page', () => {
    mount()
    // Each frame's page, as a window that scrolls.
    const pages = frames().map((frame) => {
      const page = Object.assign(new EventTarget(), { scrollY: 0, scrollTo: vi.fn() })
      Object.defineProperty(frame, 'contentWindow', { value: page, configurable: true })
      fireEvent.load(frame)
      return page
    })
    pages[1]!.scrollY = 420
    pages[1]!.dispatchEvent(new Event('scroll'))
    expect(pages[0]!.scrollTo).toHaveBeenCalledWith(0, 420)
    expect(pages[2]!.scrollTo).toHaveBeenCalledWith(0, 420)
    expect(pages[1]!.scrollTo).not.toHaveBeenCalled()
  })
})

describe('lookFrameSize', () => {
  it('fits side by side whatever the zoom, and takes the zoom one at a time', () => {
    const box = { width: 512, height: 400 }
    expect(lookFrameSize(box, 1024, 'side', 1)).toEqual({ scale: 0.5, height: 800 })
    expect(lookFrameSize(box, 1024, 'one', 1)).toEqual({ scale: 1, height: 400 })
    expect(lookFrameSize(box, 1024, 'one', 'fit')).toEqual({ scale: 0.5, height: 800 })
    // A phone narrower than its box is never drawn larger than true size.
    expect(lookFrameSize(box, 390, 'side', 'fit').scale).toBe(1)
  })

  it('scales one at a time as the canvas does', () => {
    for (const zoom of ['fit', 0.5, 0.75, 1] as const)
      for (const room of [0, 300, 1500])
        expect(lookFrameSize({ width: room, height: 600 }, 1024, 'one', zoom).scale).toBe(
          canvasScale(room, 1024, zoom)
        )
  })
})
