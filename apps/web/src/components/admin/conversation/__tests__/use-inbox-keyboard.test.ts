// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import {
  resolveShortcut,
  isEditableTarget,
  isComposerTarget,
  useInboxKeyboard,
  INBOX_GLOBAL_SHORTCUTS,
  COMPOSER_MARKER_SELECTOR,
  type ResolvableKeyEvent,
} from '../use-inbox-keyboard'

/**
 * Build a minimal event-like object; `tag` sets a fake target element and
 * `composer` makes that element answer the composer marker lookup.
 */
function ev(
  key: string,
  opts: Partial<ResolvableKeyEvent> & {
    tag?: string
    contentEditable?: boolean
    composer?: boolean
  } = {}
): ResolvableKeyEvent {
  const { tag, contentEditable, composer, ...rest } = opts
  const target =
    tag || contentEditable || composer
      ? ({
          tagName: tag ?? 'DIV',
          isContentEditable: contentEditable ?? false,
          closest: (selector: string) =>
            composer && selector === COMPOSER_MARKER_SELECTOR ? {} : null,
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
    ['m', 'macro'],
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

describe('isComposerTarget', () => {
  it('is true only inside the marked composer', () => {
    expect(isComposerTarget(ev('Escape', { composer: true, contentEditable: true }).target)).toBe(
      true
    )
    expect(isComposerTarget(ev('Escape', { contentEditable: true }).target)).toBe(false)
    expect(isComposerTarget(null)).toBe(false)
  })

  it('is false for a target with no closest lookup (plain objects, window)', () => {
    expect(isComposerTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
  })
})

describe('resolveShortcut — Escape leaves the composer', () => {
  it('returns blur-composer for Escape inside the composer', () => {
    expect(resolveShortcut(ev('Escape', { composer: true, contentEditable: true }))).toEqual({
      type: 'blur-composer',
    })
  })

  it('ignores Escape in an editable outside the composer (list search keeps its own handling)', () => {
    expect(resolveShortcut(ev('Escape', { tag: 'INPUT' }))).toBeNull()
  })

  it('ignores Escape outside any editable, so nothing else that listens is swallowed', () => {
    expect(resolveShortcut(ev('Escape'))).toBeNull()
  })

  it('ignores Escape with a modifier held', () => {
    expect(
      resolveShortcut(ev('Escape', { composer: true, contentEditable: true, metaKey: true }))
    ).toBeNull()
    expect(
      resolveShortcut(ev('Escape', { composer: true, contentEditable: true, shiftKey: true }))
    ).toBeNull()
  })

  it('yields to the editor when it already handled Escape (slash/emoji menu dismissal)', () => {
    expect(
      resolveShortcut(
        ev('Escape', { composer: true, contentEditable: true, defaultPrevented: true })
      )
    ).toBeNull()
  })
})

describe('INBOX_GLOBAL_SHORTCUTS', () => {
  it('documents Escape so the help panel advertises the way out', () => {
    expect(INBOX_GLOBAL_SHORTCUTS.map((s) => s.keys)).toContain('Esc')
  })
})

describe('useInboxKeyboard — Escape blurs the composer', () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  /** Mount a marked composer box holding a contenteditable editing surface. */
  function mountComposer() {
    const box = document.createElement('div')
    box.setAttribute('data-inbox-composer', '')
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.tabIndex = 0
    box.appendChild(editor)
    document.body.appendChild(box)
    return editor
  }

  function bind() {
    const onAction = vi.fn()
    renderHook(() =>
      useInboxKeyboard({
        enabled: true,
        onAction,
        onOpenCommandBar: vi.fn(),
        onOpenHelp: vi.fn(),
      })
    )
    return onAction
  }

  it('blurs the note editor on Escape, so the single-key actions fire again', () => {
    const onAction = bind()
    const editor = mountComposer()
    editor.focus()
    expect(document.activeElement).toBe(editor)

    // Typing a bound char while in the composer must stay inert.
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    })
    expect(onAction).not.toHaveBeenCalled()

    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.activeElement).not.toBe(editor)

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    })
    expect(onAction).toHaveBeenCalledWith('next')
  })

  it('leaves focus alone when the editor already handled Escape', () => {
    bind()
    const editor = mountComposer()
    editor.focus()

    // The editor's own menu handling marks the event handled first.
    editor.addEventListener('keydown', (e) => e.preventDefault())
    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    })
    expect(document.activeElement).toBe(editor)
  })
})
