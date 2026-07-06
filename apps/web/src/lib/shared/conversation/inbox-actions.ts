/**
 * The agent inbox's keyboard-first action registry (support platform §4.6).
 *
 * This is the single source of truth read by three surfaces: the command bar
 * (fuzzy palette), the keyboard hook (single-key shortcuts), and the shortcut
 * help panel. A descriptor carries its display label, its group, its DISPLAY-ONLY
 * shortcut hint, and the `scope` that decides when it can run. Keeping the key
 * char on the descriptor means the palette hint, the actual binding, and the
 * help panel never drift.
 *
 * Client-safe (no server imports). Convert-to-ticket is intentionally absent —
 * tickets are a later phase.
 *
 * Labels are English inline (no locale catalogue yet; see report).
 */

export type InboxActionId =
  | 'reply'
  | 'assign'
  | 'assign_team'
  | 'snooze'
  | 'priority'
  | 'close'
  | 'reopen'
  | 'next'
  | 'prev'
  | 'toggle_select'

/** The four palette/help sections, in display order. */
export type InboxActionGroup = 'Reply' | 'Assign' | 'Status' | 'Navigate'

/**
 * When an action can run:
 * - `active`    — needs a focused/open conversation (reply, note, macro, next, prev).
 * - `selection` — needs a multi-select selection (toggle_select).
 * - `both`      — runs on the active conversation OR the current selection
 *                 (assign, snooze, priority, close/reopen, …).
 */
export type InboxActionScope = 'active' | 'selection' | 'both'

export interface InboxActionDescriptor {
  id: InboxActionId
  label: string
  group: InboxActionGroup
  /** Single-key or "g then i" style hint. DISPLAY ONLY — the hook owns the wiring. */
  shortcut?: string
  scope: InboxActionScope
}

/** Group render order for the palette and the help panel. */
export const INBOX_ACTION_GROUP_ORDER: readonly InboxActionGroup[] = [
  'Reply',
  'Assign',
  'Status',
  'Navigate',
]

/**
 * Ordered registry. Order here is the order the palette shows within a group.
 * Every key char lives here and nowhere else.
 *
 * Note (n) and macro (m) return once the thread exposes a composer imperative
 * handle (next wave); until then they're omitted so the palette, keyboard, and
 * help panel never advertise a half-wired action.
 */
export const INBOX_ACTIONS: readonly InboxActionDescriptor[] = [
  { id: 'reply', label: 'Reply', group: 'Reply', scope: 'active', shortcut: 'r' },
  { id: 'assign', label: 'Assign to teammate', group: 'Assign', scope: 'both', shortcut: 'a' },
  { id: 'assign_team', label: 'Assign to team', group: 'Assign', scope: 'both', shortcut: 't' },
  { id: 'snooze', label: 'Snooze', group: 'Status', scope: 'both', shortcut: 's' },
  { id: 'priority', label: 'Set priority', group: 'Status', scope: 'both', shortcut: 'p' },
  { id: 'close', label: 'Close conversation', group: 'Status', scope: 'both', shortcut: 'e' },
  { id: 'reopen', label: 'Reopen conversation', group: 'Status', scope: 'both', shortcut: 'u' },
  { id: 'next', label: 'Next conversation', group: 'Navigate', scope: 'active', shortcut: 'j' },
  { id: 'prev', label: 'Previous conversation', group: 'Navigate', scope: 'active', shortcut: 'k' },
  {
    id: 'toggle_select',
    label: 'Select conversation',
    group: 'Navigate',
    scope: 'selection',
    shortcut: 'x',
  },
]

/** Context the availability check reads. */
export interface InboxActionContext {
  hasActiveConversation: boolean
  hasSelection: boolean
  /**
   * True when the current target (the multi-selection, or the single active
   * item when there's no selection) includes at least one ticket
   * (UNIFIED-INBOX-SPEC.md §2.5: snooze has no ticket-row equivalent — the
   * status axis stands in for it). Optional so every pre-unified-inbox call
   * site (conversation-only) is unaffected.
   */
  hasTicketTarget?: boolean
}

/**
 * Whether an action can run in the current context, from its `scope` alone.
 * Snooze is additionally disabled whenever the target includes a ticket.
 * Pure; shared by the palette and unit-tested directly.
 */
export function isInboxActionEnabled(
  descriptor: InboxActionDescriptor,
  ctx: InboxActionContext
): boolean {
  if (descriptor.id === 'snooze' && ctx.hasTicketTarget) return false
  switch (descriptor.scope) {
    case 'active':
      return ctx.hasActiveConversation
    case 'selection':
      return ctx.hasSelection
    case 'both':
      return ctx.hasActiveConversation || ctx.hasSelection
    default:
      return false
  }
}
