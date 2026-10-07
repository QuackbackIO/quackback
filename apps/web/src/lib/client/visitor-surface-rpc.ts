'use client'

/**
 * Backends-for-frontends RPC for the shared visitor messenger.
 * Portal defaults to cookie/site functions; the widget injects widget BFF fns.
 */
import { createContext, useContext } from 'react'
import {
  getMyConversationFn,
  sendConversationMessageFn,
  listConversationMessagesFn,
  mintConversationStreamTokenFn,
  submitCsatFn,
  markConversationReadFn,
  sendConversationTypingFn,
} from '@/lib/server/functions/conversation'
import {
  getConversationLinkedTicketFn,
  createMyTicketFn,
  getMyTicketStageLabelsFn,
  getMyTicketFormFn,
  getMyTicketWatchStatusFn,
  watchMyTicketFn,
  unwatchMyTicketFn,
} from '@/lib/server/functions/tickets'
import { unfurlLinkFn } from '@/lib/server/functions/link-preview'

export const portalVisitorRpc = {
  getMyConversation: getMyConversationFn,
  sendConversationMessage: sendConversationMessageFn,
  listConversationMessages: listConversationMessagesFn,
  mintConversationStreamToken: mintConversationStreamTokenFn,
  submitCsat: submitCsatFn,
  markConversationRead: markConversationReadFn,
  sendConversationTyping: sendConversationTypingFn,
  getConversationLinkedTicket: getConversationLinkedTicketFn,
  createMyTicket: createMyTicketFn,
  getMyTicketStageLabels: getMyTicketStageLabelsFn,
  getMyTicketForm: getMyTicketFormFn,
  getMyTicketWatchStatus: getMyTicketWatchStatusFn,
  watchMyTicket: watchMyTicketFn,
  unwatchMyTicket: unwatchMyTicketFn,
  unfurlLink: unfurlLinkFn,
}

export type VisitorSurfaceRpc = typeof portalVisitorRpc

const VisitorSurfaceRpcContext = createContext<VisitorSurfaceRpc>(portalVisitorRpc)

export const VisitorSurfaceRpcProvider = VisitorSurfaceRpcContext.Provider

export function useVisitorSurfaceRpc(): VisitorSurfaceRpc {
  return useContext(VisitorSurfaceRpcContext)
}
