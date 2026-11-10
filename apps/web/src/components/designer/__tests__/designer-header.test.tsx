// @vitest-environment happy-dom
/**
 * The top bar: where you are, the device as one radio group, undo and redo
 * always there and saying what they would take back, Add and Theme pressed
 * while their sheet is open, and Publish.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DesignerHeader, STATUS_SLOT_WIDTH } from '../designer-header'

afterEach(cleanup)

function show(props: Partial<Parameters<typeof DesignerHeader>[0]> = {}) {
  const handlers = {
    onExit: vi.fn(),
    onSize: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSheet: vi.fn(),
    onPreview: vi.fn(),
    onPublish: vi.fn(),
  }
  render(
    <DesignerHeader
      returnPath="/admin/settings/portal"
      workspaceName="Juniper"
      pagePicker={<button type="button">Page: Home</button>}
      size="desktop"
      undoLabel="Move block"
      redoLabel={null}
      draftStatus={<span>4 changes, not live</span>}
      sheet={null}
      canPublish
      changes={4}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

describe('the top bar', () => {
  it('holds the draft state in one fixed slot, so nothing beside it moves as it changes', () => {
    show({ draftStatus: <span>No changes</span> })
    const slot = screen.getByText('No changes').closest<HTMLElement>('[data-status-slot]')!
    expect(slot.style.width).toBe(`${STATUS_SLOT_WIDTH}px`)
    expect(slot.className).toContain('shrink-0')
    cleanup()
    show({ draftStatus: <span>Not saved. Retrying…</span> })
    const again = screen
      .getByText('Not saved. Retrying…')
      .closest<HTMLElement>('[data-status-slot]')!
    expect(again.style.width).toBe(slot.style.width)
  })

  it('never wraps onto a second row, and the right side keeps one width so the centre stays put', () => {
    show()
    const bar = screen.getByRole('banner', { name: 'Top bar' })
    expect(bar.className).not.toContain('flex-wrap')
    expect(bar.className).toContain('grid-cols-[minmax(0,1fr)_auto_auto]')
    expect(bar.children).toHaveLength(4)
  })

  it('says where you are: the workspace, then the customer portal', () => {
    show()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumbs.textContent).toBe('Juniper/Customer portal')
    expect(within(crumbs).getByText('Customer portal').getAttribute('aria-current')).toBe('page')
  })

  it('switches the device in one radio group', () => {
    const { onSize } = show()
    const group = screen.getByRole('radiogroup', { name: 'Device' })
    expect(within(group).getByRole('radio', { name: 'Desktop' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(within(group).getByRole('radio', { name: 'Phone' }))
    expect(onSize).toHaveBeenCalledWith('phone')
  })

  it('keeps undo and redo in place, redo disabled with nothing to put back', () => {
    const { onUndo, onRedo } = show()
    const undo = screen.getByRole('button', { name: 'Undo' })
    const redo = screen.getByRole('button', { name: 'Redo' })
    expect(undo.getAttribute('aria-disabled')).toBeNull()
    expect(redo.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(undo)
    fireEvent.click(redo)
    expect(onUndo).toHaveBeenCalledOnce()
    expect(onRedo).not.toHaveBeenCalled()
    expect(undo.getAttribute('title')).toBeNull()
  })

  it('names the step undo takes back in a real tooltip', async () => {
    show()
    const undo = screen.getByRole('button', { name: 'Undo' })
    await act(async () => {
      fireEvent.pointerEnter(undo, { pointerType: 'mouse' })
      fireEvent.mouseEnter(undo)
      fireEvent.focus(undo)
    })
    expect(await screen.findByText('Undo: Move block')).toBeTruthy()
  })

  it('opens Add and Theme as sheets, pressed while open', () => {
    const { onSheet } = show({ sheet: 'theme' })
    expect(screen.getByRole('button', { name: 'Theme' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Add' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSheet).toHaveBeenCalledWith('add')
  })

  it('publishes, and offers nothing to publish without changes', () => {
    const { onPublish } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(onPublish).toHaveBeenCalledOnce()
    cleanup()
    show({ changes: 0 })
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})
