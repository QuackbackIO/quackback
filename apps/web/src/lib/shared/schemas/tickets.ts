import { z } from 'zod'

export const ticketIdSchema = z.object({ ticketId: z.string() })
export type TicketIdInput = z.infer<typeof ticketIdSchema>

/** Wire shape only — the ticket service re-validates count, size, and URL. */
export const ticketAttachmentSchema = z.object({
  url: z.string(),
  name: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number(),
})

export const createMyTicketSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  descriptionJson: z.any().nullable().optional(),
  attachments: z.array(ticketAttachmentSchema).optional(),
  ticketTypeId: z.string().optional(),
  fieldValues: z.record(z.string(), z.unknown()).optional(),
  email: z.string().optional(),
})
export type CreateMyTicketInput = z.infer<typeof createMyTicketSchema>
