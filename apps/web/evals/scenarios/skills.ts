/**
 * Agent skills: use_skill is present only when an assigned skill exists.
 */
import type { Scenario } from '../types'

export const skillScenarios: Scenario[] = [
  {
    id: '36',
    title: 'use_skill is present when a skill is assigned to the Agent',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { skills: true },
    fixtures: {
      withConversation: true,
      skills: [
        {
          name: 'Refund policy',
          whenToUse: 'Customer asks for a refund',
          instructions: 'Confirm the invoice then propose a refund.',
          assignments: { agent: true, copilot: false },
        },
      ],
    },
    structural: [{ type: 'toolPresent', name: 'use_skill' }],
  },
  {
    id: '37',
    title: 'use_skill is absent when no skill is assigned to this agent',
    kind: 'toolset',
    roles: ['customer_support'],
    surface: 'widget',
    config: { skills: true },
    fixtures: {
      withConversation: true,
      skills: [
        {
          name: 'Copilot only',
          whenToUse: 'Internal billing question',
          instructions: 'Look up the subscription.',
          assignments: { agent: false, copilot: true },
        },
      ],
    },
    structural: [{ type: 'toolAbsent', name: 'use_skill' }],
  },
]
