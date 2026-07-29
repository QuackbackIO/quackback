/**
 * Shared test fixtures for the workflows domain. `makeConditionContext` was
 * previously hand-copied (with small variations) across
 * dispatcher.guards.test.ts, condition.evaluator.test.ts, and
 * workflow.engine.test.ts — this is the one builder those three now share.
 */
import type { ConditionContext } from '../condition.evaluator'

/**
 * Build a fully-populated ConditionContext for tests, with sensible defaults
 * (a real message, an identified person with a segment/company, a high-
 * priority open conversation with a few tags/attributes, a paired customer
 * ticket) that a test overrides only the fields it cares about.
 * `overrides.conversation` merges shallowly onto the default conversation (so
 * `{ conversation: { status: 'closed' } }` keeps every other conversation
 * field); every other top-level key
 * (message/person/company/ticket/officeHours/csatRating) replaces wholesale
 * when explicitly present in `overrides` (an omitted key keeps the default;
 * `null` means "explicitly absent" — the evaluator's unresolved-subject
 * contract treats that as meaningfully different from a populated value, so
 * a shallow-merge default would be wrong for those).
 */
export function makeConditionContext(overrides: Partial<ConditionContext> = {}): ConditionContext {
  const defaultConversation: ConditionContext['conversation'] = {
    status: 'open',
    channel: 'messenger',
    priority: 'high',
    waitingMinutes: 45,
    tagIds: ['ctag_vip', 'ctag_billing'],
    assignedTeamId: 'team_support',
    attributes: {
      // Envelope-shaped (the write path) and bare legacy values both resolve.
      plan: { v: 'pro', src: 'teammate', at: '2026-07-05T00:00:00.000Z' },
      seats: { v: 12, src: 'workflow', at: '2026-07-05T00:00:00.000Z' },
      areas: { v: ['opt_billing'], src: 'ai', at: '2026-07-05T00:00:00.000Z' },
      legacy_note: 'bare',
    },
  }

  return {
    message: 'message' in overrides ? overrides.message : { body: 'My card was double charged' },
    person:
      'person' in overrides
        ? overrides.person
        : {
            segmentIds: ['seg_paid'],
            email: 'ana@example.com',
            attributes: { plan: 'enterprise', seats: 25, active: true },
          },
    company:
      'company' in overrides
        ? overrides.company
        : { attributes: { plan: 'enterprise', arr: 50000 } },
    ticket: 'ticket' in overrides ? overrides.ticket : { typeId: 'ticket_type_bug' },
    officeHours: overrides.officeHours,
    csatRating: overrides.csatRating,
    conversation: { ...defaultConversation, ...overrides.conversation },
  }
}
