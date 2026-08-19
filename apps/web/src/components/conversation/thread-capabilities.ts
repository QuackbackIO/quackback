/**
 * The unified thread's capability object (UNIFIED-INBOX-SPEC.md §2.5): what a
 * given item kind/subtype turns on in `agent-conversation-thread.tsx`. A
 * conversation gets every capability; a ticket's subtype (customer vs
 * back_office/tracker) narrows the composer to note-only and drops the
 * conversation-specific extras (macros, typing, convert-to-post, link
 * previews, translation, deep-link jump, the composer's emoji picker) while
 * keeping the inbox message actions (reactions, flags, mark-unread, delete)
 * and live SSE.
 *
 * Kept as a plain data table (no branching logic in the thread component
 * itself beyond reading these flags) so the capability matrix in the spec and
 * the code can be diffed against each other directly.
 */
import type { TicketType } from '@/lib/shared/db-types'

export interface ThreadCapabilities {
  /** Reply composer tab. False = note-only (back_office/tracker tickets). */
  reply: boolean
  /** Typing indicators (send + display). */
  typing: boolean
  /** Saved-reply macro picker in the composer. */
  macros: boolean
  /** Convert-to-post / track-as-feedback affordances. */
  convertToPost: boolean
  /** External link-unfurl previews (composer + bubbles). */
  linkPreviews: boolean
  /** P2-D.1 two-way inbox translation. */
  inboxTranslation: boolean
  /** "Saved for later" / notification deep-link jump-to-message + flash. */
  deepLinkJump: boolean
  /** The composer's insert-emoji picker button. */
  emojiPicker: boolean
}

/** A conversation gets every capability. */
export const CONVERSATION_CAPABILITIES: ThreadCapabilities = {
  reply: true,
  typing: true,
  macros: true,
  convertToPost: true,
  linkPreviews: true,
  inboxTranslation: true,
  deepLinkJump: true,
  emojiPicker: true,
}

/** A ticket's capabilities, narrowed by its type. Every ticket type shares the
 *  same "no conversation extras" baseline; only `reply` varies (a customer
 *  ticket has a requester to reply to, back_office/tracker do not — see
 *  ticket-controls.tsx's assumption that a ticket always has SOME requester
 *  concept, which back_office/tracker deliberately omit at the thread level). */
export function ticketCapabilities(type: TicketType): ThreadCapabilities {
  return {
    reply: type === 'customer',
    typing: false,
    macros: false,
    convertToPost: false,
    linkPreviews: false,
    inboxTranslation: false,
    deepLinkJump: false,
    emojiPicker: false,
  }
}
