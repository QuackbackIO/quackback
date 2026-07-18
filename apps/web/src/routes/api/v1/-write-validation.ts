/**
 * Shared request-body pieces for the `/api/v1` write routes (tickets +
 * conversations). Route-local (`-` prefix keeps it out of the TanStack route
 * tree) and mirrors the server-fn wire shapes in `functions/tickets.ts` /
 * `functions/conversation.ts` so a client codes against one contract regardless
 * of transport. The per-domain `-validation.ts` files re-export from here and
 * add only what is unique to their surface (e.g. the conversation status enum).
 */
import { z } from 'zod'
import { CONVERSATION_PRIORITIES } from '@/lib/shared/db-types'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'

export const priorityEnum = z.enum(CONVERSATION_PRIORITIES)

/** A reply/note markdown body (1..4000 chars). */
export const messageContentSchema = z.string().min(1).max(4000)

/**
 * A single image/file attachment ref. The service re-validates count/size/url,
 * so this only shapes the wire payload (matches `functions/tickets.ts`).
 */
export const attachmentSchema = z.object({
  url: z.string(),
  name: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number(),
})

export const attachmentsSchema = z.array(attachmentSchema).optional()

/**
 * Cast a parsed wire attachment list to the domain shape. `name`/`contentType`
 * are optional on the wire but the service's `validateAttachments` fills/normalizes
 * them, so the cast mirrors `functions/tickets.ts`'s own handoff.
 */
export function toAttachments(
  parsed: z.infer<typeof attachmentsSchema>
): ConversationAttachment[] | undefined {
  return parsed as ConversationAttachment[] | undefined
}

/**
 * Parse caller markdown into a sanitized TipTap doc — the same derivation the
 * MCP write tools use (`sanitizeTiptapContent(markdownToTiptapJson(md))`). The
 * ticket/conversation domains sanitize a doc but never derive one from markdown
 * themselves, so every markdown-accepting entry point converts before calling
 * the service. Lets the admin inbox render richly while the stored doc matches
 * what the widget/admin produce (D3).
 */
export function markdownToSanitizedJson(markdown: string) {
  return sanitizeTiptapContent(markdownToTiptapJson(markdown))
}
