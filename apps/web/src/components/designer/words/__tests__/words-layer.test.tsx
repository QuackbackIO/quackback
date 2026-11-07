// @vitest-environment happy-dom
/**
 * The canvas's format bar: drawn over the frame where the selected words
 * are, from what the frame's words editor says, and sending back what to do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign } from '@/lib/shared/design/schema'
import type { WordsState } from '@/lib/shared/words-editor/extensions'
import { editOnCanvas } from '../edit-on-canvas'
import { WordsLayer } from '../words-layer'

afterEach(cleanup)

const STATE: WordsState = {
  kind: 'headline',
  selected: true,
  selectedLength: 4,
  accent: null,
  accentElsewhere: false,
  bold: false,
  italic: false,
  link: null,
  bulletList: false,
  orderedList: false,
  heading: 0,
  align: 'start',
  colour: null,
  accentColour: null,
  length: 15,
  limit: 280,
}

function mount() {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  const say = vi.fn()
  const design = defaultDesign()
  design.pages.home.headline = {
    title: { en: 'Help shape Acme', de: 'Gestalte Acme' },
    subtitle: {},
  }
  render(
    <WordsLayer
      canvas={{ frame, scale: 0.5, room: { width: 800, height: 600 } }}
      design={design}
      locale="en"
      say={say}
    />
  )
  const fromFrame = (data: Record<string, unknown>) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin: window.location.origin,
          source: frame.contentWindow,
        })
      )
    })
  return { frame, sent, say, fromFrame }
}

describe('the words the frame edits', () => {
  it('are the words the design stores, sent when the frame asks for them', () => {
    const { sent, fromFrame } = mount()
    fromFrame({ type: 'quackback:words-ask', field: 'home.title' })
    expect(sent).toHaveBeenCalledWith(
      {
        type: 'quackback:words-open',
        field: 'home.title',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Help shape Acme' }] }],
        },
      },
      window.location.origin
    )
  })

  it('are none where the design keeps no words, so the frame reads the page’s', () => {
    const { sent, fromFrame } = mount()
    fromFrame({ type: 'quackback:words-ask', field: 'home.subtitle' })
    expect(sent).toHaveBeenCalledWith(
      { type: 'quackback:words-open', field: 'home.subtitle', doc: null },
      window.location.origin
    )
  })

  it('are never sent to a page that is not the frame', () => {
    const { sent } = mount()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'quackback:words-ask', field: 'home.title' },
          origin: 'https://elsewhere.example',
          source: window,
        })
      )
    })
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('words a panel asks to edit', () => {
  it('are opened where they sit, by their field, in the frame', () => {
    const { sent } = mount()
    act(() => editOnCanvas('block-ideas0001.heading'))
    expect(sent).toHaveBeenCalledWith(
      { type: 'quackback:words-edit', field: 'block-ideas0001.heading' },
      window.location.origin
    )
  })

  it('are never asked of the frame for a field that is not words', () => {
    const { sent } = mount()
    act(() => editOnCanvas('nowhere'))
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('the canvas’s format bar', () => {
  it('shows the headline’s marks over the selected words, at the canvas’s scale', () => {
    const { fromFrame } = mount()
    fromFrame({
      type: 'quackback:words-state',
      field: 'home.title',
      state: STATE,
      box: { left: 100, top: 200, width: 400, height: 60 },
      selection: { left: 300, top: 210, width: 80, height: 40 },
    })
    const bar = screen.getByRole('toolbar', { name: 'Set words apart' })
    const place = bar.parentElement!.style
    expect(place.left).toBe('150px')
    // Above the words, by its foot, so it grows upwards as More opens.
    expect(place.top).toBe(`${105 - 8}px`)
    expect(bar.parentElement!.className).toContain('-translate-y-full')
    expect(screen.getByText(/German: “Gestalte Acme”/)).toBeTruthy()
  })

  it('sends the frame what the bar asks', () => {
    const { fromFrame, sent } = mount()
    fromFrame({
      type: 'quackback:words-state',
      field: 'home.title',
      state: STATE,
      box: { left: 0, top: 200, width: 400, height: 60 },
      selection: { left: 0, top: 210, width: 80, height: 40 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Lighter' }))
    expect(sent).toHaveBeenCalledWith(
      { type: 'quackback:words-command', command: { type: 'accent', style: 'muted' } },
      window.location.origin
    )
  })

  it('shows no bar for plain words, and goes when the edit ends', () => {
    const { fromFrame } = mount()
    const plain = {
      type: 'quackback:words-state',
      field: 'home.subtitle',
      state: { ...STATE, kind: 'plain' },
      box: { left: 0, top: 0, width: 10, height: 10 },
      selection: { left: 0, top: 0, width: 10, height: 10 },
    }
    fromFrame(plain)
    expect(screen.queryByRole('toolbar')).toBeNull()
    fromFrame({ ...plain, field: 'home.title', state: STATE })
    expect(screen.getByRole('toolbar')).toBeTruthy()
    fromFrame({ type: 'quackback:words-end', field: 'home.title' })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('says when a Welcome body is left to its panel', () => {
    const { fromFrame, say } = mount()
    fromFrame({ type: 'quackback:words-blocked', field: 'block-welcome001.body' })
    expect(say).toHaveBeenCalledWith(expect.stringMatching(/edited in its panel/))
  })
})
