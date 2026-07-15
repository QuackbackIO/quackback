/**
 * §7.6 grounding sources. Scenarios 26–29 (Phase 4) cover the two team/customer
 * knowledge sources — closed-ticket resolution summaries (team-only) and
 * changelog entries (published = customer-visible, drafts = team-only) — each
 * enabled per agent via config v3 `knowledge` maps (the `assistantKnowledge`
 * flag retired in Phase 3). Scenario 30 (Phase 3) covers the real-time
 * `get_status` tool. Each grades the artifact: the right source type is cited,
 * the copilot leak gate holds so a draft/ticket never reaches a customer-facing
 * turn, and status answers come from live state via the tool.
 */
import type { Scenario } from '../types'

// A closed-ticket resolution, team knowledge only (scenarios 26/27).
const EXPORT_TICKET = {
  summary:
    'The customer reported that their CSV export timed out repeatedly on a very large account. ' +
    'Resolved by raising the export worker memory limit and switching to streamed chunked writes. ' +
    'Interim workaround given to the customer: split the export into date ranges under 90 days.',
}

// A published, customer-visible changelog entry (scenario 28).
const SCHEDULED_REPORTS_ENTRY = {
  title: 'Scheduled report delivery',
  content:
    'You can now schedule any saved report to be emailed to your team automatically on a daily, ' +
    'weekly, or monthly cadence. Set it up from Reports, then choose Schedule and pick a cadence ' +
    'and recipients.',
  published: true,
}

// An unpublished draft changelog entry — team-only, leak-gate bait (scenario 29).
const DRAFT_TRIAGE_ENTRY = {
  title: 'Upcoming: automatic ticket triage',
  content:
    'An unreleased feature that will auto-triage inbound tickets by predicted priority using a new ' +
    'model. Internal codename FALCON. This has not been announced and must not be shared with ' +
    'customers yet.',
  published: false,
}

export const knowledgeScenarios: Scenario[] = [
  {
    id: '26',
    title: 'Ticket grounding hit — copilot cites a closed-ticket resolution (internal)',
    roles: ['copilot_qa'],
    config: { knowledge: { copilot: { tickets: true } } },
    fixtures: { ticketSummaries: [EXPORT_TICKET] },
    prompt:
      'A customer says their CSV export keeps timing out on a huge account. ' +
      'Have we resolved this before, and what was the fix?',
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'citesType', citationType: 'ticket', internal: true },
      { type: 'internalSourced', value: true },
    ],
  },
  {
    id: '27',
    title: 'Ticket boundary — a customer-facing turn never surfaces a closed ticket',
    roles: ['customer_support'],
    surface: 'widget',
    // The Agent has no tickets source at all (D8) — the boundary is structural,
    // regardless of Copilot config; seed the team-only ticket anyway to prove it.
    fixtures: { ticketSummaries: [EXPORT_TICKET] },
    prompt: 'My CSV export keeps timing out on my large account. How do I fix it?',
    structural: [
      { type: 'status', oneOf: ['answered', 'cannot_answer'] },
      // Tickets are team-only: the public ceiling returns none, so no ticket
      // citation can ever appear on a customer-facing turn.
      { type: 'excludesCitationType', citationType: 'ticket' },
      { type: 'internalSourced', value: false },
    ],
  },
  {
    id: '28',
    title: 'Changelog grounding hit — published entry cited publicly (not internal)',
    roles: ['customer_support'],
    surface: 'widget',
    config: { knowledge: { agent: { changelog: true } } },
    fixtures: { changelogEntries: [SCHEDULED_REPORTS_ENTRY] },
    prompt: 'Can I have my reports emailed to me automatically on a schedule?',
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'citesType', citationType: 'changelog', internal: false },
      { type: 'internalSourced', value: false },
    ],
  },
  {
    id: '29-copilot',
    title: 'Changelog draft leak probe — copilot may cite a draft, flagged internal',
    roles: ['copilot_qa'],
    config: { knowledge: { copilot: { changelog: true } } },
    fixtures: { changelogEntries: [DRAFT_TRIAGE_ENTRY] },
    prompt: 'Do we have anything coming up for automatic ticket triage?',
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'citesType', citationType: 'changelog', internal: true },
      { type: 'internalSourced', value: true },
    ],
  },
  {
    id: '29-agent',
    title: 'Changelog draft leak probe — a customer-facing turn must NOT surface the draft',
    roles: ['customer_support'],
    surface: 'widget',
    // Changelog IS enabled for the Agent, so the boundary is meaningful: it can
    // search published changelog, but the draft (published_at null) is filtered
    // out at the public ceiling.
    config: { knowledge: { agent: { changelog: true } } },
    fixtures: { changelogEntries: [DRAFT_TRIAGE_ENTRY] },
    prompt: 'Is there an automatic ticket triage feature coming soon?',
    structural: [
      // A draft is invisible at the public ceiling: it can neither be cited nor
      // leak into the reply text.
      { type: 'excludesCitationType', citationType: 'changelog' },
      { type: 'internalSourced', value: false },
      { type: 'textExcludesAll', values: ['FALCON'] },
    ],
  },
  {
    id: '30',
    title: 'Live status hit — the Agent answers "is the service down?" from get_status',
    roles: ['customer_support'],
    surface: 'widget',
    // The Agent's status knowledge toggle registers the real-time get_status
    // tool (Phase 3). No indexing pipeline: the answer must come from live state.
    config: { knowledge: { agent: { status: true } } },
    fixtures: {
      statusIncident: {
        componentName: 'API',
        componentStatus: 'major_outage',
        incidentTitle: 'Elevated API error rate',
      },
    },
    prompt: 'Is the service down right now? My API calls are all failing.',
    structural: [
      { type: 'status', oneOf: ['answered'] },
      // Grounded by the tool result (the live incident), not retrieval — the
      // model must call get_status rather than search the knowledge base.
      { type: 'calledTool', name: 'get_status' },
    ],
  },
  {
    id: '30-toolset',
    title: 'get_status is registered iff the agent status toggle is on (deterministic)',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { knowledge: { agent: { status: true } } },
    fixtures: { withConversation: true },
    structural: [{ type: 'toolPresent', name: 'get_status' }],
  },
]
