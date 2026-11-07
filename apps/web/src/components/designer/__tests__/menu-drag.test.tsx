// @vitest-environment happy-dom
/**
 * Dragging a portal menu item on the canvas: a press that barely moves stays
 * a click, past a few px a ghost of the label follows the pointer and a bar
 * shows where it would go, a drop is one named step said aloud, and Escape
 * puts it back. The frame is this window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { menuParts } from '@/lib/shared/design/menu'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { MenuLayer } from '../menu-layer'
import { useMenuEditing } from '../use-menu-editing'

vi.mock('@/lib/client/builder-events', () => ({ trackBuilder: vi.fn() }))

afterEach(() => {
  cleanup()
  document.querySelector('[data-test-menu]')?.remove()
})

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

/** The portal's menu as the frame draws it: four items, 80 wide with 10 between, from x 0. */
function menuPage() {
  const row = document.createElement('nav')
  row.setAttribute('data-test-menu', '')
  row.setAttribute('data-qb-menu-row', '')
  ;['feedback', 'roadmap', 'changelog', 'help'].forEach((id, i) => {
    const item = document.createElement('a')
    item.setAttribute('data-qb-menu', id)
    item.textContent = id
    const box = new DOMRect(i * 90, 10, 80, 30)
    item.getBoundingClientRect = () => box
    item.getClientRects = () => [box] as unknown as DOMRectList
    row.append(item)
  })
  document.body.append(row)
  return {
    contentDocument: document,
    contentWindow: window,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLIFrameElement
}

function show() {
  const frame = menuPage()
  let design = defaultDesign()
  const labels: Array<string | undefined> = []
  const say = vi.fn()
  const update = (change: (draft: PortalDesign) => void, label?: string) => {
    const next = structuredClone(design)
    change(next)
    design = next
    labels.push(label)
  }
  function Harness() {
    const editing = useMenuEditing({
      design,
      gates,
      update,
      page: 'feedback',
      setPage: vi.fn(),
      pick: vi.fn(),
      say,
    })
    return (
      <MenuLayer
        canvas={{ frame, scale: 1, room: { width: 1200, height: 800 } }}
        design={design}
        gates={gates}
        settings={{}}
        update={update}
        editing={editing}
        headerHot={false}
        coach={{ show: false, dismiss: vi.fn() }}
      />
    )
  }
  const view = render(<Harness />)
  const item = (id: string) => document.querySelector(`[data-qb-menu="${id}"]`)!
  const order = () => menuParts(design, gates).map((part) => part.id)
  return { view, say, labels, item, order }
}

const ghost = () => document.querySelector('[data-menu-drag-ghost]')
const bar = () => document.querySelector<HTMLElement>('[data-menu-drop-bar]')

describe('dragging a menu item', () => {
  it('stays a click when the pointer barely moves', () => {
    const { item, labels } = show()
    const click = vi.fn()
    window.addEventListener('click', click)
    fireEvent.pointerDown(item('roadmap'), { button: 0, clientX: 130, clientY: 20 })
    fireEvent.pointerMove(document, { clientX: 132, clientY: 21 })
    expect(ghost()).toBeNull()
    fireEvent.pointerUp(document)
    fireEvent.click(item('roadmap'))
    expect(click).toHaveBeenCalledOnce()
    expect(labels).toEqual([])
    window.removeEventListener('click', click)
  })

  it('shows a ghost of its label and the bar where it would go, then drops it as one step', () => {
    const { item, labels, say, order } = show()
    fireEvent.pointerDown(item('roadmap'), { button: 0, clientX: 130, clientY: 20 })
    act(() => void fireEvent.pointerMove(document, { clientX: 200, clientY: 22 }))
    expect(ghost()?.textContent).toBe('Roadmap')
    // The item stays in place, faded, while its ghost travels.
    expect((item('roadmap') as HTMLElement).style.opacity).toBe('0.4')
    expect(say).toHaveBeenLastCalledWith('Moving Roadmap. Escape puts it back.')
    // Over Changelog's left half: no move yet, so no bar.
    expect(bar()).toBeNull()
    act(() => void fireEvent.pointerMove(document, { clientX: 330, clientY: 22 }))
    expect(bar()?.style.left).toBe('349px')
    act(() => void fireEvent.pointerUp(document))
    expect(ghost()).toBeNull()
    expect((item('roadmap') as HTMLElement).style.opacity).toBe('')
    expect(labels).toEqual(['Move Roadmap in the menu'])
    expect(order()).toEqual(['feedback', 'changelog', 'help', 'roadmap'])
    expect(say).toHaveBeenLastCalledWith('Roadmap moved to place 4 of 4 in the menu.')
  })

  it('swallows the click a drag ends with, so the item’s menu stays shut', () => {
    const { item } = show()
    const click = vi.fn()
    document.addEventListener('click', click)
    fireEvent.pointerDown(item('roadmap'), { button: 0, clientX: 130, clientY: 20 })
    act(() => void fireEvent.pointerMove(document, { clientX: 330, clientY: 22 }))
    act(() => void fireEvent.pointerUp(document))
    fireEvent.click(item('roadmap'))
    expect(click).not.toHaveBeenCalled()
    document.removeEventListener('click', click)
  })

  it('puts it back on Escape', () => {
    const { item, labels, say, order } = show()
    fireEvent.pointerDown(item('feedback'), { button: 0, clientX: 40, clientY: 20 })
    act(() => void fireEvent.pointerMove(document, { clientX: 330, clientY: 22 }))
    act(() => void fireEvent.keyDown(document, { key: 'Escape' }))
    expect(ghost()).toBeNull()
    act(() => void fireEvent.pointerUp(document))
    expect(labels).toEqual([])
    expect(order()[0]).toBe('feedback')
    expect(say).toHaveBeenLastCalledWith('Feedback put back.')
  })

  it('leaves the logo and sign in to their clicks', () => {
    const { say } = show()
    const logo = document.createElement('a')
    logo.setAttribute('data-qb-menu', 'logo')
    document.querySelector('[data-test-menu]')!.append(logo)
    fireEvent.pointerDown(logo, { button: 0, clientX: 0, clientY: 0 })
    act(() => void fireEvent.pointerMove(document, { clientX: 300, clientY: 0 }))
    expect(ghost()).toBeNull()
    expect(say).not.toHaveBeenCalled()
  })
})

describe('moving a menu item from the keyboard', () => {
  it('says where Move right put it, from its click menu or the header panel', () => {
    const say = vi.fn()
    const { result } = renderHook(() =>
      useMenuEditing({
        design: defaultDesign(),
        gates,
        update: vi.fn(),
        page: 'feedback',
        setPage: vi.fn(),
        pick: vi.fn(),
        say,
      })
    )
    act(() => result.current.act('feedback', 'right'))
    expect(say).toHaveBeenLastCalledWith('Feedback moved to place 2 of 4 in the menu.')
    act(() => result.current.act('help', 'up', 'panel'))
    expect(say).toHaveBeenLastCalledWith('Help Center moved to place 3 of 4 in the menu.')
  })
})
