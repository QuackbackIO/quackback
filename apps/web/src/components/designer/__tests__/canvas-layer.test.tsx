// @vitest-environment happy-dom
/**
 * The canvas's editing layer as the builder wires it: Escape lets go of the
 * pick even when nothing has focus, and copy and remove reach only blocks.
 * A picked Home block on the grid moves with the arrow keys and resizes with
 * Shift and the arrows, from its grip or with nothing focused, one named
 * step each, said aloud.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { newBlock } from '@/lib/shared/design/home'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { CanvasLayer } from '../canvas-layer'

afterEach(() => {
  cleanup()
  document.querySelector('[data-test-page]')?.remove()
})

function show(picked: string | null) {
  const onDeselect = vi.fn()
  render(
    <CanvasLayer
      canvas={{ frame: null, scale: 1, room: { width: 800, height: 600 } }}
      hovered={null}
      picked={picked as never}
      name="Top posts"
      homeOn
      pages={['home', 'feedback']}
      onPage={vi.fn()}
      onDuplicate={vi.fn()}
      onRemove={vi.fn()}
      onDeselect={onDeselect}
    />
  )
  return { onDeselect }
}

describe('CanvasLayer', () => {
  it('lets go of the pick on Escape when nothing has focus', () => {
    const { onDeselect } = show('block-aaaa')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onDeselect).toHaveBeenCalledOnce()
  })

  it('leaves Escape alone when nothing is picked', () => {
    const { onDeselect } = show(null)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onDeselect).not.toHaveBeenCalled()
  })
})

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/**
 * The portal's Home as the frame would draw it, in this document: a grid of
 * `columns` columns holding the picked block. The frame is this window.
 */
function homePage(columns = 12) {
  const grid = document.createElement('div')
  grid.setAttribute('data-test-page', '')
  grid.setAttribute('data-qb-grid', '')
  grid.style.display = 'grid'
  grid.style.gridTemplateColumns = Array(columns).fill('60px').join(' ')
  const block = document.createElement('section')
  block.setAttribute('data-qb-section', 'block-ideas0001')
  block.getBoundingClientRect = () => new DOMRect(40, 100, 300, 200)
  grid.append(block)
  document.body.append(grid)
  return {
    contentDocument: document,
    contentWindow: window,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLIFrameElement
}

function onGrid(columns = 12) {
  const frame = homePage(columns)
  let design = defaultDesign()
  design.pages.home.blocks = [
    { ...newBlock('ideas', { x: 0, y: 0, w: 6, h: 8 }), id: 'ideas0001' },
    { ...newBlock('updates', { x: 6, y: 0, w: 6, h: 8 }), id: 'updates01' },
    { ...newBlock('roadmap', { x: 0, y: 8, w: 12, h: 6 }), id: 'roadmap01' },
  ]
  const labels: Array<string | undefined> = []
  const say = vi.fn()
  const update = (change: (draft: PortalDesign) => void, label?: string) => {
    const next = structuredClone(design)
    change(next)
    design = next
    labels.push(label)
  }
  const view = render(
    <CanvasLayer
      canvas={{ frame, scale: 1, room: { width: 1200, height: 800 } }}
      hovered={null}
      picked={'block-ideas0001' as never}
      name="Top posts"
      homeOn
      pages={['home']}
      onPage={vi.fn()}
      onDuplicate={vi.fn()}
      onRemove={vi.fn()}
      onDeselect={vi.fn()}
      grid={{ design, gates: ALL_ON, update, begin: vi.fn(), end: vi.fn(), say }}
    />
  )
  const placeOf = (id: string) => design.pages.home.blocks.find((block) => block.id === id)!.grid
  return { view, say, labels, placeOf }
}

describe('moving and resizing a picked Home block', () => {
  it('moves it with the arrows on its grip, said by row and column', async () => {
    const { say, labels, placeOf } = onGrid()
    const grip = await screen.findByRole('button', { name: 'Move Top posts' })
    grip.focus()
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(labels).toEqual(['Move Top posts'])
    expect(placeOf('ideas0001')).toEqual({ x: 0, y: 14, w: 6, h: 8 })
    expect(say).toHaveBeenLastCalledWith('Top posts moved to row 15, column 1.')
    expect(document.activeElement).toBe(grip)
  })

  it('resizes it with Shift and the arrows', async () => {
    const { say, labels, placeOf } = onGrid()
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move Top posts' }), {
      key: 'ArrowRight',
      shiftKey: true,
    })
    expect(labels).toEqual(['Resize Top posts'])
    expect(placeOf('ideas0001')).toEqual({ x: 0, y: 0, w: 7, h: 8 })
    expect(placeOf('updates01').y).toBe(8)
    expect(say).toHaveBeenLastCalledWith('Top posts resized to 7 columns by 8 rows.')
  })

  it('takes the arrows with nothing focused, and says when it can go no further', () => {
    const { say, labels } = onGrid()
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(labels).toEqual([])
    expect(say).toHaveBeenLastCalledWith('Top posts cannot go further that way.')
  })

  it('leaves moving to the desktop view, where the grid has its twelve columns', async () => {
    const { say, labels } = onGrid(2)
    await waitFor(() => expect(document.querySelector('[data-picked-outline]')).not.toBeNull())
    // No grip or handles on a narrower page; the arrows say where blocks move.
    expect(screen.queryByRole('button', { name: 'Move Top posts' })).toBeNull()
    expect(document.querySelectorAll('[data-resize-handle]')).toHaveLength(0)
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(labels).toEqual([])
    expect(say).toHaveBeenLastCalledWith('Blocks move and resize in the desktop view.')
  })

  it('draws resize handles on the picked block', async () => {
    const { view } = onGrid()
    await screen.findByRole('button', { name: 'Move Top posts' })
    expect(view.container.querySelectorAll('[data-resize-handle]')).toHaveLength(3)
  })
})

/**
 * Home's hero as the frame would draw it, in this document: its words 1000px
 * wide, the composer under them `width` wide. The frame is this window.
 */
function heroPage(width: number, own = false) {
  // Its own frame, where focus in the builder is apart from focus in the page.
  const iframe = own ? document.createElement('iframe') : null
  if (iframe) {
    iframe.setAttribute('data-test-page', '')
    document.body.append(iframe)
  }
  const doc = iframe?.contentDocument ?? document
  const page = doc.createElement('div')
  page.setAttribute('data-test-page', '')
  page.setAttribute('data-qb-page', 'home')
  page.innerHTML = `
    <section data-qb-section="hero" data-qb-part="band">
      <div id="words">
        <div data-qb-band-composer="">
          <div data-qb-part="composer"><input data-slot="input" /></div>
        </div>
      </div>
    </section>`
  doc.body.append(page)
  page.querySelector('#words')!.getBoundingClientRect = () => new DOMRect(100, 200, 1000, 300)
  page.querySelector('[data-qb-band-composer]')!.getBoundingClientRect = () =>
    new DOMRect(100, 400, width, 60)
  page.querySelector('[data-qb-part=composer]')!.getBoundingClientRect = () =>
    new DOMRect(100, 400, width, 60)
  if (iframe) return iframe
  return {
    contentDocument: document,
    contentWindow: window,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLIFrameElement
}

const COMPOSER = 'el:hero|input|hero.home.composer|0'

function inHero({
  width = 1000,
  centred = false,
  stored = undefined as string | undefined,
  own = false,
} = {}) {
  const frame = heroPage(width, own)
  let design = defaultDesign()
  design.layout.heroAlign = centred ? 'centre' : 'left'
  design.pages.home.blocks = [{ ...newBlock('composer'), id: 'composer01' }]
  design.pages.home.composer = 'band'
  if (stored) design.pages.home.composerWidth = stored as never
  const labels: Array<string | undefined> = []
  const steps: string[] = []
  const say = vi.fn()
  const update = (change: (draft: PortalDesign) => void, label?: string) => {
    const next = structuredClone(design)
    change(next)
    design = next
    labels.push(label)
  }
  const props = (current: PortalDesign) => ({
    canvas: { frame, scale: 1, room: { width: 1200, height: 800 } },
    hovered: null,
    picked: 'hero' as never,
    name: 'Hero',
    homeOn: true,
    pages: ['home'] as const,
    onPage: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
    onDeselect: vi.fn(),
    grid: {
      design: current,
      gates: ALL_ON,
      update,
      begin: (label: string) => steps.push(`begin ${label}`),
      end: () => steps.push('end'),
      say,
    },
    elements: {
      design: current,
      page: 'home' as const,
      hovered: null,
      picked: COMPOSER,
      force: 'base' as const,
      onPick: vi.fn(),
      say,
    },
  })
  const view = render(<CanvasLayer {...props(design)} pages={['home']} />)
  const rerender = () => view.rerender(<CanvasLayer {...props(design)} pages={['home']} />)
  return { view, say, labels, steps, rerender, width: () => design.pages.home.composerWidth }
}

describe('resizing the composer in the hero', () => {
  it('draws a right-edge handle on it, and a left one too when centred', () => {
    const { view } = inHero()
    const handles = view.container.querySelectorAll<HTMLElement>('[data-resize-handle]')
    expect([...handles].map((h) => h.dataset.resizeHandle)).toEqual(['right'])
    expect(handles[0]!.style.left).toBe('1096px')
    cleanup()
    document.querySelector('[data-test-page]')?.remove()
    const centred = inHero({ width: 640, centred: true })
    expect(
      [...centred.view.container.querySelectorAll<HTMLElement>('[data-resize-handle]')].map(
        (h) => h.dataset.resizeHandle
      )
    ).toEqual(['left', 'right'])
  })

  it('draws none with the composer on the grid', () => {
    const frame = heroPage(1000)
    const design = defaultDesign()
    design.pages.home.blocks = [{ ...newBlock('composer'), id: 'composer01' }]
    const { container } = render(
      <CanvasLayer
        canvas={{ frame, scale: 1, room: { width: 1200, height: 800 } }}
        hovered={null}
        picked={'hero' as never}
        name="Hero"
        homeOn
        pages={['home']}
        onPage={vi.fn()}
        onDuplicate={vi.fn()}
        onRemove={vi.fn()}
        onDeselect={vi.fn()}
        grid={{
          design,
          gates: ALL_ON,
          update: vi.fn(),
          begin: vi.fn(),
          end: vi.fn(),
          say: vi.fn(),
        }}
        elements={{
          design,
          page: 'home',
          hovered: null,
          picked: COMPOSER,
          force: 'base',
          onPick: vi.fn(),
          say: vi.fn(),
        }}
      />
    )
    expect(container.querySelectorAll('[data-resize-handle]')).toHaveLength(0)
  })

  it('snaps a drag of its right edge to the steps, one step to undo, said in words', () => {
    const { view, labels, steps, say, width } = inHero()
    const right = view.container.querySelector<HTMLElement>('[data-resize-handle="right"]')!
    fireEvent.pointerDown(right, { button: 0, clientX: 1100, clientY: 430 })
    // Drawn 1000px wide (full), dragged in to 420px: nearest is narrow (384px).
    fireEvent.pointerMove(window, { clientX: 520, clientY: 430 })
    expect(width()).toBe('narrow')
    expect(view.container.querySelector<HTMLElement>('[data-composer-ghost]')!.style.width).toBe(
      '384px'
    )
    expect(view.container.querySelector<HTMLElement>('[data-composer-lifted]')!.style.width).toBe(
      '420px'
    )
    fireEvent.pointerMove(window, { clientX: 590, clientY: 430 })
    expect(width()).toBe('medium')
    fireEvent.pointerUp(window)
    expect(steps).toEqual(['begin Resize Composer', 'end'])
    expect(labels.every((label) => label === undefined)).toBe(true)
    expect(say).toHaveBeenLastCalledWith('Composer width: Medium.')
    expect(view.container.querySelector('[data-composer-ghost]')).toBeNull()
  })

  it('grows on both sides when centred, and Escape puts it back', () => {
    const { view, width, say } = inHero({ width: 640, centred: true })
    const left = view.container.querySelector<HTMLElement>('[data-resize-handle="left"]')!
    // A centred composer 640px wide (wide) from 100: its left edge dragged 64px in is 512px.
    fireEvent.pointerDown(left, { button: 0, clientX: 100, clientY: 430 })
    fireEvent.pointerMove(window, { clientX: 164, clientY: 430 })
    expect(width()).toBe('medium')
    const ghost = view.container.querySelector<HTMLElement>('[data-composer-ghost]')!
    expect(ghost.style.left).toBe('164px')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(width()).toBeUndefined()
    expect(say).toHaveBeenLastCalledWith('Composer width put back.')
  })

  it('steps it with Shift and Left or Right, each a named step, said in words', () => {
    const { labels, say, width, rerender } = inHero({ width: 512, stored: 'medium' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', shiftKey: true })
    expect(width()).toBe('narrow')
    expect(labels).toEqual(['Resize Composer'])
    expect(say).toHaveBeenLastCalledWith('Composer width: Narrow.')
    rerender()
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', shiftKey: true })
    expect(labels).toHaveLength(1)
    expect(say).toHaveBeenLastCalledWith('The composer is as narrow as it goes.')
    // Without Shift, the arrows are not the composer's.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(labels).toHaveLength(1)
  })

  it('takes Shift and the arrows on the picked element’s tag, and no other button of the builder’s', () => {
    const { width } = inHero({ width: 512, stored: 'medium', own: true })
    const other = document.createElement('button')
    document.body.append(other)
    fireEvent.keyDown(other, { key: 'ArrowRight', shiftKey: true })
    expect(width()).toBe('medium')
    // The tag as the outline draws it, where focus rests once the composer is picked.
    const tag = document.createElement('button')
    tag.setAttribute('data-element-tag', '')
    document.body.append(tag)
    fireEvent.keyDown(tag, { key: 'ArrowRight', shiftKey: true })
    expect(width()).toBe('wide')
    other.remove()
    tag.remove()
  })
})
