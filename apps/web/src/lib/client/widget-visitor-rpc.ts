import {
  widgetGetMyConversationFn,
  widgetSendConversationMessageFn,
  widgetListConversationMessagesFn,
  widgetMintConversationStreamTokenFn,
  widgetSubmitCsatFn,
  widgetMarkConversationReadFn,
  widgetSendConversationTypingFn,
} from '@/lib/server/functions/widget/conversation'
import {
  widgetGetConversationLinkedTicketFn,
  widgetCreateMyTicketFn,
  widgetGetMyTicketStageLabelsFn,
  widgetGetMyTicketFormFn,
  widgetGetMyTicketWatchStatusFn,
  widgetWatchMyTicketFn,
  widgetUnwatchMyTicketFn,
} from '@/lib/server/functions/widget/tickets'
import type { VisitorSurfaceRpc } from './visitor-surface-rpc'

export const widgetVisitorRpc: VisitorSurfaceRpc = {
  getMyConversation: widgetGetMyConversationFn,
  sendConversationMessage: widgetSendConversationMessageFn,
  listConversationMessages: widgetListConversationMessagesFn,
  mintConversationStreamToken: widgetMintConversationStreamTokenFn,
  submitCsat: widgetSubmitCsatFn,
  markConversationRead: widgetMarkConversationReadFn,
  sendConversationTyping: widgetSendConversationTypingFn,
  getConversationLinkedTicket: widgetGetConversationLinkedTicketFn,
  createMyTicket: widgetCreateMyTicketFn,
  getMyTicketStageLabels: widgetGetMyTicketStageLabelsFn,
  getMyTicketForm: widgetGetMyTicketFormFn,
  getMyTicketWatchStatus: widgetGetMyTicketWatchStatusFn,
  watchMyTicket: widgetWatchMyTicketFn,
  unwatchMyTicket: widgetUnwatchMyTicketFn,
}
