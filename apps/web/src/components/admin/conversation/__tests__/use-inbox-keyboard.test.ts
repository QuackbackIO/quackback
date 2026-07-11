import { describe, it, expect } from 'vitest'
import { resolveShortcut, isEditableTarget, type ResolvableKeyEvent } from '../use-inbox-keyboard'

/** Build a minimal event-like object; `tag` sets a fake target element. */
function ev(
  key: string,
  opts: Partial<ResolvableKeyEvent> & { tag?: string; contentEditable?: boolean } = {}
): ResolvableKeyEvent {
  const { tag, contentEditable, ...rest } = opts
  const target =
    tag || contentEditable
      ? ({
          tagName: tag ?? 'DIV',
          isContentEditable: contentEditable ?? false,
        } as unknown as EventTarget)
      : null
  return { key, target, ...rest }
}

describe('isEditableTarget', () => {
  it('detects inputs, textareas, selects and contenteditable', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true)
  })

  it('is false for non-editable targets and null', () => {
    expect(isEditableTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(undefined)).toBe(false)
  })
})

describe('resolveShortcut — global keys', () => {
  it('opens the command bar on Cmd-K and Ctrl-K', () => {
    expect(resolveShortcut(ev('k', { metaKey: true }))).toEqual({ type: 'command-bar' })
    expect(resolveShortcut(ev('K', { ctrlKey: true }))).toEqual({ type: 'command-bar' })
  })

  it('opens the command bar even while typing', () => {
    expect(resolveShortcut(ev('k', { metaKey: true, tag: 'INPUT' }))).toEqual({
      type: 'command-bar',
    })
  })

  it('opens help on ? when not typing', () => {
    expect(resolveShortcut(ev('?'))).toEqual({ type: 'help' })
  })

  it('suppresses ? while typing', () => {
    expect(resolveShortcut(ev('?', { tag: 'TEXTAREA' }))).toBeNull()
    expect(resolveShortcut(ev('?', { contentEditable: true }))).toBeNull()
  })
})

describe('resolveShortcut — single-key actions', () => {
  const cases: Array<[string, string]> = [
    ['r', 'reply'],
    ['q', 'copilot'],
    ['a', 'assign'],
    ['t', 'assign_team'],
    ['s', 'snooze'],
    ['p', 'priority'],
    ['e', 'close'],
    ['u', 'reopen'],
    ['j', 'next'],
    ['k', 'prev'],
    ['x', 'toggle_select'],
  ]

  it.each(cases)('maps %s to %s', (key, id) => {
    expect(resolveShortcut(ev(key))).toEqual({ type: 'action', id })
  })

  it('is case-insensitive on the char', () => {
    expect(resolveShortcut(ev('R'))).toEqual({ type: 'action', id: 'reply' })
  })

  it('returns null for an unbound key', () => {
    expect(resolveShortcut(ev('z'))).toBeNull()
  })
})

describe('resolveShortcut — input-focus suppression', () => {
  it('ignores single keys typed in an input/textarea/contenteditable', () => {
    expect(resolveShortcut(ev('r', { tag: 'INPUT' }))).toBeNull()
    expect(resolveShortcut(ev('s', { tag: 'TEXTAREA' }))).toBeNull()
    expect(resolveShortcut(ev('e', { contentEditable: true }))).toBeNull()
  })

  it('ignores single keys when a modifier is held', () => {
    // Ctrl-R must reload, not reply; Alt/Shift combos must not fire either.
    expect(resolveShortcut(ev('r', { ctrlKey: true }))).toBeNull()
    expect(resolveShortcut(ev('r', { metaKey: true }))).toBeNull()
    expect(resolveShortcut(ev('r', { altKey: true }))).toBeNull()
    expect(resolveShortcut(ev('r', { shiftKey: true }))).toBeNull()
  })
})
