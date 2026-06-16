/**
 * Client-side fetch wrappers for the widget ticket endpoints introduced in
 * Phase 2. Handles Bearer token injection and maps the `{ code, message }`
 * error envelope to a typed `WidgetTicketError`.
 */
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import type { TicketId, TicketStatusId, PrincipalId } from '@quackback/ids'

export type StatusCategory = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'
export type WidgetSupportPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface WidgetSupportCategory {
  categoryKey: string
  label: string
  description?: string
  icon?: string
  defaultPriority?: WidgetSupportPriority
  allowedPriorities?: WidgetSupportPriority[]
  visible?: boolean
  display?: {
    showPrioritySelector?: boolean
    showAttachments?: boolean
    showResolveAction?: boolean
    showReopenAction?: boolean
    emptyStateTitle?: string
    emptyStateDescription?: string
  }
}

export interface WidgetTicketRow {
  id: TicketId
  subject: string
  statusId: TicketStatusId
  statusCategory: StatusCategory
  statusName: string
  statusColor: string | null
  lastActivityAt: string
  createdAt: string
}

export interface WidgetTicketDetail {
  id: TicketId
  subject: string
  descriptionJson: unknown | null
  descriptionText: string | null
  statusId: TicketStatusId
  statusCategory: StatusCategory
  statusName: string
  statusColor: string | null
  createdAt: string
  lastActivityAt: string
  updatedAt: string
}

export interface WidgetTicketThread {
  id: string
  principalId: PrincipalId | null
  audience: 'public'
  bodyJson: unknown | null
  bodyText: string | null
  createdAt: string
  editedAt: string | null
}

export interface WidgetTicketDetailResponse {
  ticket: WidgetTicketDetail
  threads: WidgetTicketThread[]
  principalNames: Record<string, string>
  viewerPrincipalId: PrincipalId | null
}

export interface WidgetTicketCreateInput {
  subject: string
  bodyText?: string | null
  priority?: WidgetSupportPriority
  categoryKey?: string
}

export interface WidgetTicketDescriptionUpdateInput {
  expectedUpdatedAt: string
  descriptionJson: { type: 'doc'; content?: unknown[] } | null
  descriptionText: string | null
}

export interface WidgetTicketDescriptionUpdateResponse {
  id: TicketId
  updatedAt: string
}

export interface WidgetTicketCreateResponse {
  id: TicketId
  subject: string
  statusId: TicketStatusId
  statusCategory: StatusCategory
  statusName: string
  statusColor: string | null
  createdAt: string
  lastActivityAt: string
}

export interface WidgetTicketReplyResponse {
  id: string
  ticketId: TicketId
  audience: 'public'
  createdAt: string
}

export interface WidgetTicketResolveResponse {
  id: TicketId
  statusId: TicketStatusId
  statusCategory: StatusCategory | 'closed'
  alreadyResolved: boolean
  updatedAt?: string
}

export interface WidgetTicketReopenResponse {
  id: TicketId
  statusId: TicketStatusId
  statusCategory: StatusCategory
  alreadyOpen: boolean
  updatedAt?: string
}

export class WidgetTicketError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'WidgetTicketError'
    this.code = code
    this.status = status
  }
}

async function widgetFetch<T>(
  url: string,
  init: RequestInit & { jsonBody?: unknown } = {}
): Promise<T> {
  const { jsonBody, headers, ...rest } = init
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...getWidgetAuthHeaders(),
    ...(jsonBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...((headers as Record<string, string> | undefined) ?? {}),
  }
  const res = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : (init.body ?? undefined),
  })
  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    // empty
  }
  if (!res.ok) {
    const env = (payload ?? {}) as {
      error?: { code?: string; message?: string }
      code?: string
      message?: string
    }
    const code = env.error?.code ?? env.code ?? 'UNKNOWN'
    const message = env.error?.message ?? env.message ?? `Request failed with ${res.status}`
    throw new WidgetTicketError(code, message, res.status)
  }
  const env = (payload ?? {}) as { data?: T }
  if (env.data === undefined) {
    throw new WidgetTicketError('UNKNOWN', 'Malformed response', res.status)
  }
  return env.data
}

export interface ListWidgetTicketsParams {
  statusCategory?: StatusCategory
  limit?: number
  offset?: number
}

export async function listWidgetTickets(
  params: ListWidgetTicketsParams = {}
): Promise<{ rows: WidgetTicketRow[]; total: number }> {
  const search = new URLSearchParams()
  if (params.statusCategory) search.set('statusCategory', params.statusCategory)
  if (params.limit != null) search.set('limit', String(params.limit))
  if (params.offset != null) search.set('offset', String(params.offset))
  const qs = search.toString()
  return widgetFetch(`/api/widget/tickets${qs ? `?${qs}` : ''}`)
}

export async function getWidgetTicket(
  ticketId: TicketId | string
): Promise<WidgetTicketDetailResponse> {
  return widgetFetch(`/api/widget/tickets/${encodeURIComponent(ticketId)}`)
}

export async function createWidgetTicket(
  input: WidgetTicketCreateInput
): Promise<WidgetTicketCreateResponse> {
  return widgetFetch(`/api/widget/tickets`, {
    method: 'POST',
    jsonBody: input,
  })
}

export async function replyToWidgetTicket(
  ticketId: TicketId | string,
  bodyText: string
): Promise<WidgetTicketReplyResponse> {
  return widgetFetch(`/api/widget/tickets/${encodeURIComponent(ticketId)}/replies`, {
    method: 'POST',
    jsonBody: { bodyText },
  })
}

export async function updateWidgetTicketDescription(
  ticketId: TicketId | string,
  input: WidgetTicketDescriptionUpdateInput
): Promise<WidgetTicketDescriptionUpdateResponse> {
  return widgetFetch(`/api/widget/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'PATCH',
    jsonBody: input,
  })
}

export async function resolveWidgetTicket(
  ticketId: TicketId | string
): Promise<WidgetTicketResolveResponse> {
  return widgetFetch(`/api/widget/tickets/${encodeURIComponent(ticketId)}/resolve`, {
    method: 'POST',
  })
}

export async function reopenWidgetTicket(
  ticketId: TicketId | string
): Promise<WidgetTicketReopenResponse> {
  return widgetFetch(`/api/widget/tickets/${encodeURIComponent(ticketId)}/reopen`, {
    method: 'POST',
  })
}
