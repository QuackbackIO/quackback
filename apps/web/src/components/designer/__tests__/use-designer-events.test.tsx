// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PostHog } from 'posthog-js'
import { setAnalyticsClient } from '@/lib/client/analytics'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { DesignerPage, Selection } from '@/lib/shared/design/outline'
import { useCountedUpdate, useDesignerEvents, useDesignerVisit } from '../use-designer-events'

const capture = vi.fn()
const events = () => capture.mock.calls.map(([event, props]) => [event, props])

beforeEach(() => {
  capture.mockReset()
  setAnalyticsClient({ capture } as unknown as PostHog)
})
afterEach(() => {
  cleanup()
  setAnalyticsClient(null)
})

type State = {
  page: DesignerPage
  selection: Selection | null
  panel: 'settings' | 'ai'
  versions: boolean
  help: boolean
}

function renderEvents() {
  const design = defaultDesign()
  design.pages.home.blocks = [{ id: 'abcdefgh12', type: 'links' } as never]
  const initial: State = {
    page: 'home',
    selection: null,
    panel: 'settings',
    versions: false,
    help: false,
  }
  const view = renderHook((state: State) => useDesignerEvents({ ...state, design }), {
    initialProps: initial,
  })
  let state = initial
  return (next: Partial<State>) => {
    state = { ...state, ...next }
    view.rerender(state)
  }
}

describe('useDesignerEvents', () => {
  it('sends nothing as the builder first draws', () => {
    renderEvents()
    expect(capture).not.toHaveBeenCalled()
  })

  it('counts a page switch once', () => {
    const set = renderEvents()
    set({ page: 'roadmap' })
    set({ page: 'roadmap' })
    expect(events()).toEqual([['designer_page_switched', { page: 'roadmap' }]])
  })

  it('counts a pick once, naming a block by its type', () => {
    const set = renderEvents()
    set({ selection: 'block-abcdefgh12' })
    set({ selection: 'block-abcdefgh12' })
    set({ selection: 'header' })
    expect(events()).toEqual([
      ['designer_part_picked', { part: 'block:links' }],
      ['designer_part_picked', { part: 'header' }],
    ])
  })

  it('counts the panels: Quackback AI, the settings, and the overview when nothing is picked', () => {
    const set = renderEvents()
    set({ panel: 'ai' })
    set({ panel: 'settings' })
    set({ selection: 'header' })
    set({ panel: 'ai' })
    set({ panel: 'settings' })
    set({ selection: null })
    expect(events()).toEqual([
      ['designer_panel_opened', { panel: 'ai' }],
      ['designer_panel_opened', { panel: 'overview' }],
      ['designer_part_picked', { part: 'header' }],
      ['designer_panel_opened', { panel: 'ai' }],
      ['designer_panel_opened', { panel: 'settings' }],
      ['designer_panel_opened', { panel: 'overview' }],
    ])
  })

  it('counts Versions and the shortcuts each time they open', () => {
    const set = renderEvents()
    set({ versions: true })
    set({ versions: false })
    set({ versions: true })
    set({ help: true })
    expect(events()).toEqual([
      ['designer_versions_opened', {}],
      ['designer_versions_opened', {}],
      ['designer_panel_opened', { panel: 'help' }],
    ])
  })
})

describe('useDesignerVisit', () => {
  it('counts the open, and the close once when the page goes', () => {
    const view = renderHook(() => useDesignerVisit('appearance'))
    expect(events()).toEqual([['designer_opened', { entry: 'appearance' }]])
    act(() => void window.dispatchEvent(new Event('pagehide')))
    view.unmount()
    expect(capture.mock.calls.filter(([event]) => event === 'designer_closed')).toHaveLength(1)
  })
})

describe('useCountedUpdate', () => {
  it('passes the change on and counts it by its setting', () => {
    let design = defaultDesign()
    const draft = {
      update: (change: (next: PortalDesign) => void) => {
        const next = structuredClone(design)
        change(next)
        design = next
      },
    }
    const { result } = renderHook(() =>
      useCountedUpdate(draft as unknown as Parameters<typeof useCountedUpdate>[0], 'help')
    )
    result.current((next) => void (next.layout.width = 'wide'), 'Width')
    expect(design.layout.width).toBe('wide')
    expect(events()).toEqual([['designer_setting_changed', { setting: 'layout.width' }]])
  })
})

describe('useCountedUpdate: a refused change', () => {
  it('is not counted, and its reason goes to the line under its control', () => {
    const refuse = vi.fn()
    const clear = vi.fn()
    const draft = {
      update: (change: (next: PortalDesign) => void) => {
        change(structuredClone(defaultDesign()))
        return { ok: false, reason: 'Use 40 characters or fewer' }
      },
    }
    const { result } = renderHook(() =>
      useCountedUpdate(draft as unknown as Parameters<typeof useCountedUpdate>[0], 'help', {
        refuse,
        clear,
      })
    )
    result.current((next) => void (next.nav.home.label = 'x'.repeat(41)), 'Home: label')
    expect(events()).toEqual([])
    expect(refuse).toHaveBeenCalledWith('Use 40 characters or fewer')
    expect(clear).not.toHaveBeenCalled()
  })
})
