export type DraftFromMessage = { ok: true; title: string; boardId: string } | { ok: false }

/**
 * Build a one-click draft-post suggestion from a chat message. Returns the
 * board + capped title when the message is usable as a post title, else
 * `{ ok: false }` so the caller can fall back to the full dialog.
 */
export function draftFromMessage(content: string, boardId: string | undefined): DraftFromMessage {
  const title = content.trim().slice(0, 200)
  if (title.length < 3 || !boardId) return { ok: false }
  return { ok: true, title, boardId }
}
