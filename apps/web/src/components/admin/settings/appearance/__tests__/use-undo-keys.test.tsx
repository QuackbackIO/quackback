// @vitest-environment happy-dom
/** The undo keys work across Appearance, except in a field that keeps its own undo. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useUndoKeys } from '../use-undo-keys'

afterEach(cleanup)

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ctrlKey: true, ...init }))
}

describe('useUndoKeys', () => {
  it('undoes with Ctrl or Cmd and Z, and redoes with Shift or Y', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    renderHook(() => useUndoKeys(undo, redo))
    press('z')
    press('z', { ctrlKey: false, metaKey: true })
    press('Z', { shiftKey: true })
    press('y')
    expect(undo).toHaveBeenCalledTimes(2)
    expect(redo).toHaveBeenCalledTimes(2)
  })

  it('leaves the keys to a field being typed in', () => {
    const undo = vi.fn()
    renderHook(() => useUndoKeys(undo, vi.fn()))
    const input = document.createElement('input')
    document.body.append(input)
    press('z', {}, input)
    expect(undo).not.toHaveBeenCalled()
    input.remove()
  })
})
