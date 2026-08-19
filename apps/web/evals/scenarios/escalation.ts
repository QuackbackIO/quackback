/**
 * §7.3 Escalation & control (scenarios 6–9). Quinn decides THAT it hands off,
 * never where. Scenario 9 (silence rule) is deterministic — no model call.
 */
import type { Scenario } from '../types'

export const escalationScenarios: Scenario[] = [
  {
    id: '06',
    title: 'Explicit "talk to a human" → handoff, no answer-shaped filler',
    roles: ['customer_support'],
    surface: 'widget',
    // handoff_to_human registers only on a public turn WITH a real
    // conversation (availableWhen) — without this fixture the tool cannot
    // exist and an honest "no transfer capability" reply is correct.
    fixtures: { withConversation: true },
    prompt: 'I do not want a bot. Please connect me to a human agent right now.',
    structural: [{ type: 'handoff', reasonOneOf: ['explicit_request'] }, { type: 'noCitations' }],
  },
  {
    id: '07',
    title: 'Frustration → offer accepted → handoff (the offer-first escalation chain)',
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: { withConversation: true },
    // The designed flow: frustration prompts an OFFER of a teammate, never a
    // unilateral transfer; the customer's acceptance is what fires the
    // handoff. This thread tests the final step of that chain (see 07-offer
    // for the offer itself).
    thread: [
      { sender: 'customer', content: 'This is the third time I am asking and nothing works.' },
      { sender: 'assistant', content: 'I am sorry for the trouble. Let me try to help.' },
      {
        sender: 'customer',
        content:
          'I am absolutely fed up. This product is garbage and you keep wasting my time. Fix it NOW.',
      },
      {
        sender: 'assistant',
        content:
          'I hear how frustrating this has been, and I am sorry. Would you like me to connect you with someone on the team who can dig into this directly?',
      },
      { sender: 'customer', content: 'Yes. Please get me a real person.' },
    ],
    structural: [{ type: 'handoff', reasonOneOf: ['explicit_request', 'frustration'] }],
  },
  {
    id: '07-offer',
    title: 'Frustration signals → the reply offers a teammate instead of pressing on',
    // Judgment-variance scenario: exact phrasing of the offer flips run to run.
    repeats: 3,
    stabilityThreshold: 2 / 3,
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: { withConversation: true },
    // The problem is concretely stated in the thread: a further "what exactly
    // is wrong?" is stalling, not triage — the offer (or escalation) is the
    // only defensible next move.
    thread: [
      {
        sender: 'customer',
        content:
          'Your CSV export has failed with a timeout error every single time this week. This is the third time I am asking and nothing works.',
      },
      { sender: 'assistant', content: 'I am sorry for the trouble. Let me try to help.' },
      {
        sender: 'customer',
        content:
          'I am absolutely fed up. This product is garbage and you keep wasting my time. Fix it NOW.',
      },
    ],
    structural: [
      // Either response is acceptable at this point: offering a teammate in
      // text, or escalating directly on the strong signal. What must NOT
      // happen is a third round of "could you clarify...".
      { type: 'status', oneOf: ['answered', 'cannot_answer'] },
      {
        type: 'textIncludesAny',
        values: ['team', 'someone', 'person', 'human', 'colleague', 'transfer', 'connect'],
      },
    ],
  },
  {
    id: '44',
    title: 'Mild first-time annoyance with KB coverage → answers, never hands off',
    // The counter-scenario to the offer-first frustration rule: light
    // negativity on a first ask must not read as "frustration building".
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: {
      withConversation: true,
      kbArticles: [
        {
          title: 'Changing your billing email',
          content:
            'To change the billing email, open Settings, then Billing, then Billing contacts. ' +
            'Invoices go to the new address from the next billing cycle onward.',
        },
      ],
    },
    prompt:
      "Ugh, this is a bit annoying — I've been clicking around and can't find where to change my billing email. Where is it?",
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'citesType', citationType: 'article' },
      { type: 'noHandoff' },
    ],
  },
  {
    id: '08',
    title: 'Low-confidence judgment case → prefers handoff over confident wrongness',
    roles: ['customer_support'],
    surface: 'widget',
    // No KB seeded and a high-stakes, workspace-specific ask the model cannot
    // safely guess at — it should hand off (or honestly report inability)
    // rather than invent an answer. Judgment-variance scenario: run 5x.
    repeats: 5,
    stabilityThreshold: 0.6,
    prompt:
      'My company is mid-acquisition. Will migrating our workspace to a new legal entity void our signed data-processing agreement and trigger the liability clause?',
    structural: [{ type: 'status', oneOf: ['answered', 'cannot_answer'] }, { type: 'noCitations' }],
  },
  {
    id: '09',
    title: 'Silence rule — a human teammate replied last, so Quinn must skip',
    roles: ['customer_support'],
    surface: 'widget',
    thread: [
      { sender: 'customer', content: 'Is anyone there? I need help with my invoice.' },
      { sender: 'assistant', content: 'Hi! I can help with that.' },
      { sender: 'human_agent', content: "Hi, this is Dana from support — I've got this one." },
      { sender: 'customer', content: 'Thanks Dana.' },
    ],
    structural: [{ type: 'suppressed' }],
  },
]
