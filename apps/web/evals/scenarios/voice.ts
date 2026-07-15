/**
 * §7.3 Voice & config (scenarios 15–19). These gate the config UI itself: tone
 * and length are judged contrasts; writing guidelines and guidance rules are
 * asserted structurally (plus a judge for the writing-guideline voice).
 */
import type { Scenario, SeedGuidance } from '../types'

const BILLING_ARTICLE = {
  title: 'Updating your billing details',
  content:
    'To change the card on file, open Settings, then Billing, then Payment method. ' +
    'Changes apply to your next invoice. You can also update your billing email from the same screen.',
}

const REFUND_GUIDANCE: SeedGuidance = {
  name: 'Mention the money-back guarantee on refund questions',
  appliesWhen: 'The customer is asking about refunds, cancellations, or getting their money back.',
  instruction:
    'Whenever the topic is refunds or billing disputes, clearly mention our 30-day money-back guarantee.',
  agent: 'agent',
}

export const voiceScenarios: Scenario[] = [
  {
    id: '15',
    title: 'Tone adherence — warm vs professional, judge-scored contrast',
    kind: 'contrast',
    roles: ['customer_support'],
    surface: 'widget',
    prompt: 'I was charged twice this month and I am pretty upset about it. What can you do?',
    variants: [
      { label: 'warm', config: { tone: 'warm' } },
      { label: 'professional', config: { tone: 'professional' } },
    ],
    rubric: { file: 'tone-contrast.v1.md', dimension: 'tone' },
  },
  {
    id: '16',
    title: 'Response length — brief vs detailed produce measurably different lengths',
    kind: 'contrast',
    roles: ['customer_support'],
    surface: 'widget',
    prompt: 'How do I change the credit card on my account?',
    variants: [
      { label: 'brief', config: { responseLength: 'brief' } },
      { label: 'detailed', config: { responseLength: 'detailed' } },
    ],
    rubric: { file: 'length-contrast.v1.md', dimension: 'length' },
  },
  {
    id: '17',
    title: 'Writing guidelines applied (the "Howdy partner!" fixture)',
    roles: ['customer_support'],
    surface: 'widget',
    config: {
      additionalInstructions:
        'Always open the reply with a friendly Western greeting such as "Howdy partner!" and keep a folksy, cowboy-flavored voice throughout.',
    },
    fixtures: { kbArticles: [BILLING_ARTICLE] },
    prompt: 'How do I update the card on my account?',
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'textIncludesAny', values: ['howdy', 'partner', "y'all", 'reckon'] },
    ],
    rubric: { file: 'writing-guidelines.v1.md', dimension: 'writing-guidelines' },
  },
  {
    id: '18',
    title: 'Guidance rule fires when its condition matches',
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: { guidance: [REFUND_GUIDANCE] },
    prompt: 'Can I get a refund on the plan I bought last week?',
    structural: [
      { type: 'status', oneOf: ['answered', 'cannot_answer'] },
      {
        type: 'textIncludesAny',
        values: ['30-day', '30 day', 'money-back', 'money back', 'guarantee'],
      },
    ],
  },
  {
    id: '19',
    title: 'Guidance rule does NOT fire when the condition does not match',
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: { guidance: [REFUND_GUIDANCE] },
    prompt: 'What are your support hours during the week?',
    structural: [
      { type: 'status', oneOf: ['answered', 'cannot_answer'] },
      { type: 'textExcludesAll', values: ['money-back guarantee', '30-day money-back'] },
    ],
  },
]
