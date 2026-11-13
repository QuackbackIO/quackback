import { z } from 'zod'

export const ticketIdSchema = z.object({ ticketId: z.string() })
export type TicketIdInput = z.infer<typeof ticketIdSchema>

/** Wire shape only — the ticket service re-validates count, size, and URL. */
export const ticketAttachmentSchema = z.object({
  url: z.string(),
  name: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number(),
  /** A file from the upload pipeline; the server rebuilds the rest from its row. */
  fileId: z.string().max(64).optional(),
})

/**
 * A ticket due date on the wire: an ISO 8601 instant with an explicit zone
 * (`Z` or an offset). The allowed window is checked server-side by
 * `assertTicketDueAt`; see `lib/shared/ticket-due.ts`.
 */
export const ticketDueAtWireSchema = z.string().datetime({ offset: true })

export const createMyTicketSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  descriptionJson: z.any().nullable().optional(),
  attachments: z.array(ticketAttachmentSchema).optional(),
  ticketTypeId: z.string().optional(),
  fieldValues: z.record(z.string(), z.unknown()).optional(),
  email: z.string().optional(),
  /** The customer's proposed "Needed by" date (end of their chosen day). */
  dueAt: ticketDueAtWireSchema.optional(),
})
export type CreateMyTicketInput = z.infer<typeof createMyTicketSchema>

/** List the colleagues the requester may share a ticket with (names only). */
export const ticketColleaguesSchema = z.object({
  ticketId: z.string(),
  query: z.string().max(100).optional(),
})

/** Share a ticket with a colleague, picked from the list or typed by email. */
export const shareMyTicketSchema = z
  .object({
    ticketId: z.string(),
    principalId: z.string().optional(),
    email: z.string().max(320).optional(),
  })
  .refine((d) => Boolean(d.principalId) !== Boolean(d.email), {
    message: 'Pass exactly one of principalId or email',
  })
export type ShareMyTicketInput = z.infer<typeof shareMyTicketSchema>

/** Take someone off a shared ticket (yourself, to leave it). */
export const removeMyTicketShareSchema = z.object({
  ticketId: z.string(),
  principalId: z.string(),
})
