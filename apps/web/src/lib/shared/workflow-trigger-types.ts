/**
 * The trigger types a workflow can dispatch on — every event
 * `eventToWorkflowTrigger` (apps/web/src/lib/server/domains/workflows/event-trigger.ts)
 * maps to a WorkflowTrigger, none more. This is the single canonical list, shared
 * by both sides the same way other client/server constants live under lib/shared
 * (e.g. routing.ts): the authoring validation (workflow.schemas.ts) rejects a
 * typo'd or stale `triggerType` on save, and the builder's trigger picker
 * (workflow-graph.ts's TRIGGER_TYPES) renders from the same array so the two can
 * never drift.
 *
 * Keep in sync with `eventToWorkflowTrigger`'s switch by hand — adding a new
 * dispatchable event there needs an entry here too, or workflows can never be
 * authored against it (create/update would reject the new triggerType as
 * unknown).
 */
export const DISPATCHABLE_TRIGGER_TYPES = [
  'conversation.created',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.priority_changed',
  'conversation.attribute_changed',
  'conversation.csat_submitted',
  'message.created',
  'message.note_created',
  'assistant.handed_off',
  'assistant.resolved',
  // Timer-driven triggers (support platform §4.6): synthetic events emitted by
  // workflow-sweep.ts's 5-minute tick (the unresponsive pair) or the SLA
  // domain's deadline scan (the SLA pair), never by a real user/system action.
  // See event-trigger.ts's eventToWorkflowTrigger and dispatcher.ts's
  // dispatchWorkflowTrigger `targetWorkflowId` for how these route
  // differently from every trigger above.
  'conversation.customer_unresponsive',
  'conversation.teammate_unresponsive',
  'sla.approaching_breach',
  'sla.breached',
  // Ticket triggers (conversation-linked tickets only, support platform's
  // ticket-triggers extension): a ticket event's own payload carries no
  // conversationId, so these only ever dispatch when the ticket has a linked
  // CUSTOMER conversation (ticket_conversations) — event-trigger.ts's
  // dispatchWorkflowsForEvent resolves that join before mapping the event,
  // and maps to no dispatch at all when there's no link.
  'ticket.created',
  'ticket.status_changed',
] as const

export type DispatchableTriggerType = (typeof DISPATCHABLE_TRIGGER_TYPES)[number]

/**
 * Trigger types that never travel the event bus: `page.visited` is dispatched
 * straight from the beacon pipeline (track.service.ts's
 * dispatchPageVisitWorkflows) against the identified visitor's latest
 * conversation, so there is no EventData payload and no eventToWorkflowTrigger
 * case for it — the two lookups (device -> principal, principal -> latest
 * conversation) are request-path work, not event mapping. Kept OUT of
 * DISPATCHABLE_TRIGGER_TYPES so that array keeps its 1:1 coverage contract
 * with eventToWorkflowTrigger's switch (see the sync test in
 * event-trigger.test.ts).
 */
export const NON_EVENT_TRIGGER_TYPES = ['page.visited'] as const

/**
 * Every trigger type a workflow may be authored against: the event-bus
 * dispatchables plus the non-event ones above. Authoring validation
 * (workflow.schemas.ts's triggerTypeSchema) uses this union; the dispatcher
 * fans out on whichever list the firing source used.
 */
export const AUTHORABLE_TRIGGER_TYPES = [
  ...DISPATCHABLE_TRIGGER_TYPES,
  ...NON_EVENT_TRIGGER_TYPES,
] as const

export type AuthorableTriggerType = (typeof AUTHORABLE_TRIGGER_TYPES)[number]
