// @vitest-environment happy-dom
/**
 * Renaming a menu item in place: a field over its words, at their size, with
 * the name selected. Enter or leaving keeps the name, Escape keeps the old.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MenuRename } from '../menu-rename'

afterEach(cleanup)

function show() {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <MenuRename
      box={{ left: 100, top: 20, width: 90, height: 30 }}
      font={{ size: 14, weight: '500', family: 'Inter' }}
      scale={0.5}
      name="What is new"
      onSave={onSave}
      onCancel={onCancel}
    />
  )
  const field = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
  return { field, onSave, onCancel }
}

describe('MenuRename', () => {
  it('sits over the words at their size, focused, with the name selected', () => {
    const { field } = show()
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('What is new')
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe('What is new'.length)
    expect(field.style.fontSize).toBe('7px')
    expect(field.maxLength).toBe(40)
    expect(screen.getByText('to save')).toBeTruthy()
  })

  it('keeps the new name on Enter', () => {
    const { field, onSave, onCancel } = show()
    fireEvent.change(field, { target: { value: 'Updates' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('Updates')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('keeps the old name on Escape, and saves nothing as it goes', () => {
    const { field, onSave, onCancel } = show()
    fireEvent.change(field, { target: { value: 'Updates' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.blur(field)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps the new name when focus leaves, once', () => {
    const { field, onSave } = show()
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith('')
  })
})
