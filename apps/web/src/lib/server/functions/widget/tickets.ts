import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'

const ticketIdSchema = z.object({ ticketId: z.string() })
const conversationIdSchema = z.object({ conversationId: z.string() })
const createMyTicketSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  descriptionJson: z.any().nullable().optional(),
  attachments: z
    .array(
      z.object({
        url: z.string(),
        name: z.string().optional(),
        contentType: z.string().optional(),
        size: z.number(),
      })
    )
    .optional(),
  ticketTypeId: z.string().optional(),
  fieldValues: z.record(z.string(), z.unknown()).optional(),
  email: z.string().optional(),
})

export const widgetGetMyTicketsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireWidgetAuth } = await import('../widget-auth')
  const { runGetMyTickets } = await import('../tickets')
  return runGetMyTickets(await requireWidgetAuth())
})

export const widgetGetMyTicketStageLabelsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runGetMyTicketStageLabels } = await import('../tickets')
    return runGetMyTicketStageLabels(await requireWidgetAuth())
  }
)

export const widgetGetMyTicketFormFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireWidgetAuth } = await import('../widget-auth')
  const { runGetMyTicketForm } = await import('../tickets')
  return runGetMyTicketForm(await requireWidgetAuth())
})

export const widgetGetMyTicketWatchStatusFn = createServerFn({ method: 'GET' })
  .validator(ticketIdSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runGetMyTicketWatchStatus } = await import('../tickets')
    return runGetMyTicketWatchStatus(await requireWidgetAuth(), data)
  })

export const widgetGetConversationLinkedTicketFn = createServerFn({ method: 'GET' })
  .validator(conversationIdSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runGetConversationLinkedTicket } = await import('../tickets')
    return runGetConversationLinkedTicket(await requireWidgetAuth(), data)
  })

export const widgetCreateMyTicketFn = createServerFn({ method: 'POST' })
  .validator(createMyTicketSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runCreateMyTicket } = await import('../tickets')
    return runCreateMyTicket(await requireWidgetAuth(), data)
  })

export const widgetWatchMyTicketFn = createServerFn({ method: 'POST' })
  .validator(ticketIdSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runWatchMyTicket } = await import('../tickets')
    return runWatchMyTicket(await requireWidgetAuth(), data)
  })

export const widgetUnwatchMyTicketFn = createServerFn({ method: 'POST' })
  .validator(ticketIdSchema)
  .handler(async ({ data }) => {
    const { requireWidgetAuth } = await import('../widget-auth')
    const { runUnwatchMyTicket } = await import('../tickets')
    return runUnwatchMyTicket(await requireWidgetAuth(), data)
  })
