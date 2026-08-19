/**
 * The inbox's keyboard-first layer (support platform §4.6). A thin global
 * keydown hook over a pure `resolveShortcut` resolver so the key mapping and the
 * input-focus suppression are unit-testable without a DOM.
 *
 * Bindings:
 * - Cmd/Ctrl-K   → open the command bar (allowed from anywhere, even inputs)
 * - ?            → open the shortcut help (suppressed while typing)
 * - Esc          → leave the thread composer (the only key honoured while
 *                  typing, and only from inside the composer)
 * - single keys  → the common actions (r/a/t/s/p/e/u, j/k, x), all
 *                  suppressed while typing or when a modifier is held
 *
 * `r`/`n` focus a composer and `Esc` is the matching way back out, so the pair
 * closes the keyboard loop: focus never has to be handed back with the mouse.
 *
 * The single-key chars come from `INBOX_ACTIONS` (each descriptor's `shortcut`),
 * so this file adds no new source of truth for them.
 */
import { useEffect, useRef } from 'react'
import { INBOX_ACTIONS, type InboxActionId } from '@/lib/shared/conversation/inbox-actions'

/**
 * Non-action global shortcuts (display strings), single-sourced here for the
 * help panel. Action keys live on the descriptors; these are the only keys this
 * hook owns that aren't actions.
 */
export const INBOX_GLOBAL_SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '⌘K', label: 'Open command bar' },
  { keys: '?', label: 'Show keyboard shortcuts' },
  { keys: 'Esc', label: 'Leave the composer' },
]

/**
 * The attribute the thread stamps on the box holding the reply/note editor.
 * Escape is scoped to targets underneath it, so no other editable surface in
 * the inbox (list search, a dialog field) changes behaviour.
 */
export const COMPOSER_MARKER_SELECTOR = '[data-inbox-composer]'

/** Single-key char → action id, derived from the registry (chars are unique). */
const KEY_TO_ACTION: Readonly<Record<string, InboxActionId>> = Object.fromEntries(
  INBOX_ACTIONS.filter((a) => a.shortcut).map((a) => [a.shortcut!.toLowerCase(), a.id])
)

/** The minimal shape `resolveShortcut` reads — a KeyboardEvent satisfies it. */
export interface ResolvableKeyEvent {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: EventTarget | null
  /** True once something closer to the target has claimed the key. */
  defaultPrevented?: boolean
}

export type InboxShortcutResult =
  | { type: 'command-bar' }
  | { type: 'help' }
  | { type: 'blur-composer' }
  | { type: 'action'; id: InboxActionId }
  | null

/**
 * True when the event originated in a text-entry surface, so typing a reply
 * never fires an action. Duck-typed (not `instanceof`) so it works against real
 * events and plain test objects alike.
 */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!target) return false
  const el = target as { tagName?: string; isContentEditable?: boolean }
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable === true
}

/**
 * True when the event originated inside the thread's composer box. Duck-typed
 * on `closest` for the same reason as `isEditableTarget`, and false for any
 * target that cannot answer the lookup (the window, a plain object).
 */
export function isComposerTarget(target: EventTarget | null | undefined): boolean {
  if (!target) return false
  const el = target as { closest?: (selector: string) => unknown }
  if (typeof el.closest !== 'function') return false
  return Boolean(el.closest(COMPOSER_MARKER_SELECTOR))
}

/**
 * Pure key → intent resolver. Returns `null` when nothing should fire.
 *
 * Cmd/Ctrl-K is honoured from anywhere. Escape is honoured from inside the
 * composer, where it is the way back out to the single-key actions. Everything
 * else is suppressed while typing. Single-key actions additionally require no
 * modifier held (so Ctrl-R still reloads and shift-selection never triggers an
 * action).
 */
export function resolveShortcut(e: ResolvableKeyEvent): InboxShortcutResult {
  const key = e.key
  const mod = Boolean(e.metaKey || e.ctrlKey)

  // Cmd/Ctrl-K — allowed even from an input.
  if (mod && key.toLowerCase() === 'k') return { type: 'command-bar' }

  // Esc inside the composer — the counterpart to the `r`/`n` focus keys. The
  // editor's own Esc surfaces (slash and emoji menus) sit closer to the target
  // and mark the event handled, and dismissing one of those must not also
  // throw focus out of the composer.
  if (
    key === 'Escape' &&
    !mod &&
    !e.altKey &&
    !e.shiftKey &&
    !e.defaultPrevented &&
    isComposerTarget(e.target)
  ) {
    return { type: 'blur-composer' }
  }

  const typing = isEditableTarget(e.target)

  // ? — allowed from anywhere except while typing. Needs no Cmd/Ctrl/Alt.
  if (!typing && !mod && !e.altKey && key === '?') return { type: 'help' }

  // Single-key actions — never while typing or with any modifier.
  if (typing || mod || e.altKey || e.shiftKey) return null
  const id = KEY_TO_ACTION[key.toLowerCase()]
  return id ? { type: 'action', id } : null
}

export interface UseInboxKeyboardOptions {
  /** Bind while true; unbind on false/unmount. */
  enabled: boolean
  onAction: (id: InboxActionId) => void
  onOpenCommandBar: () => void
  onOpenHelp: () => void
}

/** Binds a global keydown listener that dispatches via `resolveShortcut`. */
export function useInboxKeyboard({
  enabled,
  onAction,
  onOpenCommandBar,
  onOpenHelp,
}: UseInboxKeyboardOptions): void {
  // Latest callbacks in a ref so the listener identity stays stable across renders.
  const handlers = useRef({ onAction, onOpenCommandBar, onOpenHelp })
  handlers.current = { onAction, onOpenCommandBar, onOpenHelp }

  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      const result = resolveShortcut(event)
      if (!result) return
      // Blurring the composer hands focus back to the document, which is all
      // the single-key actions need. The key itself stays uncancelled so any
      // enclosing dismissable layer still sees its own Escape.
      if (result.type === 'blur-composer') {
        ;(event.target as { blur?: () => void } | null)?.blur?.()
        return
      }
      event.preventDefault()
      if (result.type === 'command-bar') handlers.current.onOpenCommandBar()
      else if (result.type === 'help') handlers.current.onOpenHelp()
      else handlers.current.onAction(result.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
