-- Convergence Phase 0 (scratchpad/convergence-design.md, mechanics appendix):
-- the conversation<->ticket pair is 1:1 on the CUSTOMER side so the pair-thread
-- union loader can resolve "the pair" from either direction. 0150 enforced only
-- one CUSTOMER ticket per conversation (ticket_conversations_customer_uq); the
-- schema still let one customer ticket link several conversations, which leaves
-- "the pair" undefined for the union read. This is the mirror image: at most
-- one conversation per CUSTOMER ticket. Partial (same shape as 0150's) so
-- back-office/tracker links never collide. linkTicketToConversation surfaces a
-- violation here as a friendly ConflictError, mirroring the conversation-side
-- ALREADY_LINKED guard.
CREATE UNIQUE INDEX "ticket_conversations_customer_ticket_uq"
	ON "ticket_conversations" ("ticket_id") WHERE ticket_type = 'customer';
