/**
 * Whether a notification channel's board filter applies to an event type.
 *
 * Only post and comment events belong to a board. A channel's board filter is
 * stored on every one of its event mappings, so support and changelog events
 * must ignore it rather than be held back for want of a board.
 */
export function isBoardScopedEvent(eventType: string): boolean {
  return eventType.startsWith('post.') || eventType.startsWith('comment.')
}
