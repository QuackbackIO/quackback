/**
 * Ticket domain module exports (support platform §4.2).
 *
 * IMPORTANT: this barrel re-exports TYPES only. Service functions that touch the
 * database are NOT exported here so they never get bundled into the client;
 * import them directly from './ticket.service' / './ticket-status.service' in
 * server-only code (server functions, API routes).
 */
export type {
  CreateTicketInput,
  AssignTicketInput,
  TicketSort,
  TicketAssigneeFilter,
  TicketListFilter,
  TicketPrincipalRef,
  TicketStatusRef,
  TicketStageRef,
  TicketAssigneeRef,
  TicketCompanyRef,
  TicketDTO,
  TicketListPage,
} from './ticket.types'
