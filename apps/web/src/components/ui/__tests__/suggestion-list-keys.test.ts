import { describe, expect, it, vi } from 'vitest'
import { applySuggestionListKey, resolveSuggestionListKey } from '../suggestion-list-keys'

function key(name: string): Pick<KeyboardEvent, 'key'> {
  return { key: name }
}

describe('resolveSuggestionListKey', () => {
  const three = { count: 3, selected: 1 }

  it('returns none when the list is empty', () => {
    expect(resolveSuggestionListKey(key('Enter'), { count: 0, selected: 0 })).toEqual({
      type: 'none',
    })
    expect(resolveSuggestionListKey(key('Tab'), { count: 0, selected: 0 })).toEqual({
      type: 'none',
    })
  })

  it('ArrowDown/ArrowUp wrap around', () => {
    expect(resolveSuggestionListKey(key('ArrowDown'), three)).toEqual({ type: 'move', index: 2 })
    expect(resolveSuggestionListKey(key('ArrowDown'), { count: 3, selected: 2 })).toEqual({
      type: 'move',
      index: 0,
    })
    expect(resolveSuggestionListKey(key('ArrowUp'), three)).toEqual({ type: 'move', index: 0 })
    expect(resolveSuggestionListKey(key('ArrowUp'), { count: 3, selected: 0 })).toEqual({
      type: 'move',
      index: 2,
    })
  })

  it('Home/End jump to first/last', () => {
    expect(resolveSuggestionListKey(key('Home'), three)).toEqual({ type: 'move', index: 0 })
    expect(resolveSuggestionListKey(key('End'), three)).toEqual({ type: 'move', index: 2 })
  })

  it('Enter, Tab, and Shift+Tab (key is still Tab) confirm', () => {
    expect(resolveSuggestionListKey(key('Enter'), three)).toEqual({ type: 'confirm' })
    expect(resolveSuggestionListKey(key('Tab'), three)).toEqual({ type: 'confirm' })
  })

  it('ignores unrelated keys so the editor keeps them', () => {
    expect(resolveSuggestionListKey(key('a'), three)).toEqual({ type: 'none' })
    expect(resolveSuggestionListKey(key(' '), three)).toEqual({ type: 'none' })
    expect(resolveSuggestionListKey(key('Escape'), three)).toEqual({ type: 'none' })
  })
})

describe('applySuggestionListKey', () => {
  const items = ['a', 'b', 'c']

  it('moves via onMove and does not confirm', () => {
    const onMove = vi.fn()
    const onConfirm = vi.fn()
    expect(
      applySuggestionListKey(key('ArrowDown'), { items, selected: 0, onMove, onConfirm })
    ).toBe(true)
    expect(onMove).toHaveBeenCalledWith(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Tab confirms the highlighted row (Slack-style)', () => {
    const onMove = vi.fn()
    const onConfirm = vi.fn()
    expect(applySuggestionListKey(key('Tab'), { items, selected: 1, onMove, onConfirm })).toBe(true)
    expect(onConfirm).toHaveBeenCalledWith('b')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('returns false for unused keys', () => {
    expect(
      applySuggestionListKey(key('x'), {
        items,
        selected: 0,
        onMove: vi.fn(),
        onConfirm: vi.fn(),
      })
    ).toBe(false)
  })
})
