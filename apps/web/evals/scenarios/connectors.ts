/**
 * Agent Connectors toolset gates. Assembly assertions only — no remote MCP call.
 */
import type { Scenario } from '../types'

const AGENT_ONLY = { agent: true, copilot: false }
const COPILOT_ONLY = { agent: false, copilot: true }

const INVOICE_TOOL = 'connector_acme-billing__get_invoice'

export const connectorScenarios: Scenario[] = [
  {
    id: '31',
    title: 'connector assigned to the Agent is present on a customer_support turn',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { connectors: true },
    fixtures: {
      withConversation: true,
      connectors: [
        {
          name: 'Acme Billing',
          tools: [{ name: 'get_invoice', readOnly: true }],
          assignments: AGENT_ONLY,
        },
      ],
    },
    structural: [{ type: 'toolPresent', name: INVOICE_TOOL }],
  },
  {
    id: '32',
    title: 'Agent-assigned connector is absent on the Copilot turn',
    kind: 'toolset',
    roles: ['copilot_qa'],
    config: { connectors: true },
    fixtures: {
      withConversation: true,
      connectors: [
        {
          name: 'Acme Billing',
          tools: [{ name: 'get_invoice', readOnly: true }],
          assignments: AGENT_ONLY,
        },
      ],
    },
    structural: [{ type: 'toolAbsent', name: INVOICE_TOOL }],
  },
  {
    id: '33',
    title: 'never-policy connector tool is absent from assembly',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { connectors: true },
    fixtures: {
      withConversation: true,
      connectors: [
        {
          name: 'Acme Billing',
          tools: [{ name: 'get_invoice', readOnly: true, policy: 'never' }],
          assignments: AGENT_ONLY,
        },
      ],
    },
    structural: [{ type: 'toolAbsent', name: INVOICE_TOOL }],
  },
  {
    id: '34',
    title: 'connectors flag off hides assigned tools',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { connectors: false },
    fixtures: {
      withConversation: true,
      connectors: [
        {
          name: 'Acme Billing',
          tools: [{ name: 'get_invoice', readOnly: true }],
          assignments: AGENT_ONLY,
        },
      ],
    },
    structural: [{ type: 'toolAbsent', name: INVOICE_TOOL }],
  },
  {
    id: '35',
    title: 'Copilot-assigned connector is present on a copilot_qa turn',
    kind: 'toolset',
    roles: ['copilot_qa'],
    config: { connectors: true },
    fixtures: {
      withConversation: true,
      connectors: [
        {
          name: 'Acme Billing',
          tools: [{ name: 'get_invoice', readOnly: true }],
          assignments: COPILOT_ONLY,
        },
      ],
    },
    structural: [{ type: 'toolPresent', name: INVOICE_TOOL }],
  },
]
