/**
 * Widget BFF for requester tickets. Portal keeps tickets.ts on cookie/site auth.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  createMyTicketSchema,
  runGetMyTickets,
  runGetMyTicketStageLabels,
  runGetMyTicketForm,
  runGetMyTicketWatchStatus,
  runGetConversationLinkedTicket,
  runCreateMyTicket,
  runWatchMyTicket,
  runUnwatchMyTicket,
  type CreateMyTicketInput,
} from '../tickets'
import { requireWidgetAuth } from '../widget-auth'

export const widgetGetMyTicketsFn = createServerFn({ method: 'GET' }).handler(async () => {
  return runGetMyTickets(await requireWidgetAuth())
})

export const widgetGetMyTicketStageLabelsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    return runGetMyTicketStageLabels(await requireWidgetAuth())
  }
)

export const widgetGetMyTicketFormFn = createServerFn({ method: 'GET' }).handler(async () => {
  return runGetMyTicketForm(await requireWidgetAuth())
})

export const widgetGetMyTicketWatchStatusFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    return runGetMyTicketWatchStatus(await requireWidgetAuth(), data)
  })

export const widgetGetConversationLinkedTicketFn = createServerFn({ method: 'GET' })
  .validator(z.object({ conversationId: z.string() }))
  .handler(async ({ data }) => {
    return runGetConversationLinkedTicket(await requireWidgetAuth(), data)
  })

export const widgetCreateMyTicketFn = createServerFn({ method: 'POST' })
  .validator(createMyTicketSchema)
  .handler(async ({ data }: { data: CreateMyTicketInput }) => {
    return runCreateMyTicket(await requireWidgetAuth(), data)
  })

export const widgetWatchMyTicketFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    return runWatchMyTicket(await requireWidgetAuth(), data)
  })

export const widgetUnwatchMyTicketFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    return runUnwatchMyTicket(await requireWidgetAuth(), data)
  })
