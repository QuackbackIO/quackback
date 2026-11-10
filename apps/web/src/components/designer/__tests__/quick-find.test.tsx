// @vitest-environment happy-dom
/**
 * Ctrl+K opens quick find, from the designer or its canvas. Each entry shows
 * where it is ("Feed › Posts › Sort"); the arrows and Enter choose one and
 * Escape closes it. Choosing a setting takes the builder to its place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { outlineOf, type DesignerPage } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign } from '@/lib/shared/design/schema'
import { blockFindActions, type FindItem } from '../find-index'
import { revealRow } from '../find-reveal'
import { QuickFind } from '../quick-find'

const events = vi.hoisted(() => ({ trackBuilder: vi.fn() }))
vi.mock('@/lib/client/builder-events', () => events)

afterEach(() => {
  cleanup()
  events.trackBuilder.mockClear()
})

const GATES: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: false,
  help: false,
  support: false,
  status: false,
}
const PAGES: DesignerPage[] = ['feedback', 'roadmap']
const design = defaultDesign()
const source = {
  design,
  gates: GATES,
  nodes: outlineOf(design, 'roadmap'),
  page: 'roadmap' as const,
  pages: PAGES,
}
const PLACEHOLDER = 'Find a block, page, setting or action…'

function show(actions?: () => FindItem[]) {
  const navigation = { show: vi.fn(), pick: vi.fn(), page: vi.fn() }
  render(<QuickFind source={source} navigation={navigation} actions={actions} />)
  return navigation
}

async function typeIn(words: string) {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const input = await screen.findByPlaceholderText(PLACEHOLDER)
  fireEvent.change(input, { target: { value: words } })
  return input
}

/** The entries shown, as each reads. */
const shown = () =>
  [...document.querySelectorAll('[cmdk-item]')].map((item) => item.textContent?.trim())

describe('QuickFind', () => {
  it('sits anchored near the top, so the box never moves as the results change', async () => {
    show()
    await typeIn('sort')
    const box = document.querySelector<HTMLElement>('[data-quick-find]')!
    const classes = box.className.split(/\s+/)
    expect(classes).toContain('top-[15vh]')
    expect(classes).toContain('translate-y-0')
    expect(classes).not.toContain('top-[50%]')
    expect(classes).not.toContain('translate-y-[-50%]')
  })

  it('shows each setting with where it is, never an id', async () => {
    show()
    await typeIn('sort')
    expect(shown()).toContain('Feed › Posts › Sort')
    for (const text of shown()) expect(text).not.toMatch(/site:|block-/)
  })

  it('greys a setting it cannot go to, saying why, and goes nowhere on it', async () => {
    const off: FindItem = {
      id: 'part:hero:hero-height',
      group: 'Settings',
      label: 'Height',
      path: ['Hero', 'Layout'],
      off: 'On Home, which is off',
      target: { kind: 'part', selection: 'hero', page: 'home' },
    }
    const navigation = show(() => [off])
    await typeIn('height')
    const item = document.querySelector('[data-find-item="part:hero:hero-height"]')!
    expect(item.getAttribute('data-disabled')).toBe('true')
    expect(item.textContent).toContain('On Home, which is off')
    fireEvent.click(item)
    expect(navigation.show).not.toHaveBeenCalled()
  })

  it('leads a setting on another page to its part there', async () => {
    const navigation = show()
    await typeIn('sort')
    fireEvent.click(screen.getByText('Sort'))
    expect(navigation.show).toHaveBeenCalledWith({
      kind: 'part',
      selection: 'feed',
      page: 'feedback',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('finds an element’s properties by what people call them', async () => {
    show()
    await typeIn('button colour')
    expect(shown()).toContain('Elements › Main buttons › Background')
    expect(shown()).toContain('Elements › Main buttons › Text colour')
  })

  it('chooses with the arrows and Enter, and closes on Escape', async () => {
    const navigation = show()
    const input = await typeIn('corners')
    expect(document.querySelector('[cmdk-item][aria-selected=true]')?.textContent).toBe(
      'Theme › Style › Corners'
    )
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigation.show).toHaveBeenCalledWith({ kind: 'theme', at: { element: null } })
    const again = await typeIn('corners')
    fireEvent.keyDown(again, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('does an action, read as it opens, and closes', async () => {
    const duplicate = vi.fn()
    const actions = vi.fn(() =>
      blockFindActions({
        picked: 'Top posts',
        onAdd: vi.fn(),
        onLayouts: vi.fn(),
        onDuplicate: duplicate,
        onRemove: vi.fn(),
      })
    )
    show(actions)
    expect(actions).not.toHaveBeenCalled()
    await typeIn('duplicate')
    fireEvent.click(await screen.findByText('Duplicate Top posts'))
    expect(duplicate).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('counts each time it opens, once', async () => {
    show()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await screen.findByPlaceholderText(PLACEHOLDER)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(events.trackBuilder.mock.calls).toEqual([
      ['designer_panel_opened', { panel: 'quick_find' }],
    ])
  })

  it('opens when the canvas hands over its Ctrl+K, and not for another origin or window', async () => {
    show()
    // The canvas's frame, and another frame of the same origin.
    const box = document.createElement('div')
    box.setAttribute('data-canvas-box', '')
    const iframe = document.createElement('iframe')
    box.append(iframe)
    document.body.append(box)
    const canvas = { postMessage: vi.fn() } as unknown as Window
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, get: () => canvas })
    const other = { postMessage: vi.fn() } as unknown as Window
    const send = (origin: string, source: Window | null) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'quackback:preview-key', key: 'find' },
            origin,
            source,
          })
        )
      })
    try {
      send('https://elsewhere.example.com', canvas)
      send(window.location.origin, other)
      send(window.location.origin, null)
      expect(screen.queryByRole('dialog')).toBeNull()
      send(window.location.origin, canvas)
      expect(await screen.findByRole('dialog')).toBeTruthy()
    } finally {
      box.remove()
    }
  })
})

describe('revealRow', () => {
  const mount = (html: string) => {
    const root = document.createElement('div')
    root.setAttribute('data-panel-under', '')
    root.innerHTML = html
    document.body.append(root)
    Element.prototype.scrollIntoView = vi.fn()
    return root
  }

  it('waits for a row drawn late, then focuses its picked tile and outlines it', async () => {
    const root = mount('')
    const found = revealRow({ root: '[data-panel-under]', row: 'theme-corners' })
    setTimeout(() => {
      root.innerHTML =
        '<div data-find="theme-corners"><button role="radio" aria-checked="false">Sharp</button><button role="radio" aria-checked="true">Round</button></div>'
    }, 60)
    const control = await found
    expect(control?.textContent).toBe('Round')
    expect(document.activeElement).toBe(control)
    expect(root.querySelector('[data-find]')!.hasAttribute('data-find-flash')).toBe(true)
    root.remove()
  })

  it('opens the disclosure it sits under first, and an element’s More', async () => {
    const root = mount(
      '<button data-find-open="theme-advanced" aria-expanded="false">Advanced</button><details><summary>More</summary><div data-find="element-button-shadow"><input aria-label="Shadow" /></div></details>'
    )
    const advanced = root.querySelector('button')!
    const opened = vi.fn()
    advanced.addEventListener('click', opened)
    const control = await revealRow({
      root: '[data-panel-under]',
      row: 'element-button-shadow',
      opens: 'theme-advanced',
    })
    expect(opened).toHaveBeenCalledOnce()
    expect(root.querySelector('details')!.open).toBe(true)
    expect(document.activeElement).toBe(control)
    root.remove()
  })

  it('leaves focus in the properties, never on the body, when the row never draws', async () => {
    const settings = document.createElement('aside')
    settings.id = 'designer-settings'
    settings.tabIndex = -1
    document.body.append(settings)
    const root = mount('')
    expect(await revealRow({ root: '[data-panel-under]', row: 'gone', waitMs: 50 })).toBeNull()
    expect(document.activeElement).toBe(settings)
    root.remove()
    settings.remove()
  })
})
