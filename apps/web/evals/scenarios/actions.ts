/**
 * §7.6 Phase 5 gate — custom actions library (QUINN-TWO-AGENT-SPEC D6).
 *
 * Per the gate: for each custom action, an assigned-executes scenario (the tool
 * is present in its assigned agent's assembled set — assembly IS what makes it
 * executable through the pipeline) and an unassigned scenario (the tool is
 * absent from the schema). These are `toolset` scenarios: deterministic
 * assembly assertions with NO model call and NO HTTP — a seeded action's URL is
 * never fetched here, so the eval never contacts an external host (a hard §7.2
 * constraint). Direct end-to-end execution (template substitution + allowlist
 * filtering + SSRF guard) is covered by the service unit tests, not a
 * model-in-the-loop turn, which would be both flaky and network-dependent.
 *
 * The registration matrix each scenario leans on:
 *   assigned to agent + enabled + flag on  -> present for that agent only
 *   assigned to the other agent            -> absent for this agent
 *   disabled, or flag off                  -> absent for everyone
 */
import type { Scenario } from '../types'

const AGENT_ONLY = { agent: true, copilot: false }
const COPILOT_ONLY = { agent: false, copilot: true }

const REFUND_ACTION = {
  name: 'Lookup order',
  whenToUse: 'Call to look up an order status by its id when the customer asks about a purchase.',
  variables: [{ name: 'order_id', description: 'The order id the customer referenced.' }],
  responseAllowlist: ['status', 'items[].name'],
}

/** The stable tool name the runtime derives from the action name (`action_<slug>`). */
const REFUND_TOOL = 'action_lookup_order'

export const actionScenarios: Scenario[] = [
  {
    id: '31',
    title: 'custom action assigned to the Agent is present on a customer_support turn',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { customActions: true },
    fixtures: {
      withConversation: true,
      customActions: [{ ...REFUND_ACTION, assignments: AGENT_ONLY }],
    },
    structural: [{ type: 'toolPresent', name: REFUND_TOOL }],
  },
  {
    id: '32',
    title: 'Agent-assigned custom action is absent on the Copilot turn (assignment is per agent)',
    kind: 'toolset',
    roles: ['copilot_qa'],
    config: { customActions: true },
    fixtures: {
      withConversation: true,
      customActions: [{ ...REFUND_ACTION, assignments: AGENT_ONLY }],
    },
    structural: [{ type: 'toolAbsent', name: REFUND_TOOL }],
  },
  {
    id: '33',
    title: 'custom action assigned to the Copilot is present on a copilot_qa turn',
    kind: 'toolset',
    roles: ['copilot_qa'],
    config: { customActions: true },
    fixtures: {
      withConversation: true,
      customActions: [{ ...REFUND_ACTION, assignments: COPILOT_ONLY }],
    },
    structural: [{ type: 'toolPresent', name: REFUND_TOOL }],
  },
  {
    id: '34',
    title: 'Copilot-assigned custom action is absent on the Agent turn',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { customActions: true },
    fixtures: {
      withConversation: true,
      customActions: [{ ...REFUND_ACTION, assignments: COPILOT_ONLY }],
    },
    structural: [{ type: 'toolAbsent', name: REFUND_TOOL }],
  },
  {
    id: '35',
    title: 'a disabled custom action never registers, even when assigned',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { customActions: true },
    fixtures: {
      withConversation: true,
      customActions: [{ ...REFUND_ACTION, assignments: AGENT_ONLY, enabled: false }],
    },
    structural: [{ type: 'toolAbsent', name: REFUND_TOOL }],
  },
  {
    id: '36',
    title: 'flag off — an assigned, enabled custom action is absent from the toolset',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { customActions: false },
    fixtures: {
      withConversation: true,
      customActions: [{ ...REFUND_ACTION, assignments: AGENT_ONLY }],
    },
    structural: [{ type: 'toolAbsent', name: REFUND_TOOL }],
  },
]
