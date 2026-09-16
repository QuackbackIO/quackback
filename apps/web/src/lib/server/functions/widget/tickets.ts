import { createServerFn } from '@tanstack/react-start'
import { conversationIdSchema } from '@/lib/shared/schemas/conversation'
import { ticketIdSchema, createMyTicketSchema } from '@/lib/shared/schemas/tickets'

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
