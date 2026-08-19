/**
 * §7.3 Grounding & tools (scenarios 1–5). Each seeds its own small, anonymized
 * KB and grades the artifact: a grounded answer cites ledger-backed sources; an
 * honest miss reports inability with zero citations; the search budget holds.
 */
import type { Scenario } from '../types'

const REFUND_ARTICLE = {
  title: 'Refunds and cancellations',
  content:
    'You can request a full refund within 30 days of your purchase, no questions asked. ' +
    'After 30 days, refunds are prorated for the unused portion of your subscription. ' +
    'To start a refund, open Settings, then Billing, and choose "Request refund". ' +
    'Refunds are returned to your original payment method within 5 to 10 business days.',
}

const EXPORT_ARTICLE = {
  title: 'Exporting your data',
  content:
    'You can download a complete archive of everything stored in your account. ' +
    'The archive is generated as a downloadable CSV bundle and emailed to you when it is ready. ' +
    'Large accounts may take up to an hour to prepare. The archive includes all records you have created.',
}

const OFFICE_HOURS_ARTICLE = {
  title: 'When our team is available',
  content:
    'Our support team is available Monday to Friday, 9am to 5pm Pacific time. ' +
    'Outside those hours you can still leave a message and we will reply the next business day.',
}

export const groundingScenarios: Scenario[] = [
  {
    id: '01',
    title: 'Grounded answer with correct citations',
    roles: ['customer_support', 'copilot_qa'],
    surface: 'widget',
    fixtures: { kbArticles: [REFUND_ARTICLE] },
    prompt: 'What is your refund policy?',
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'minCitations', n: 1 },
      { type: 'citationsSubsetOfLedger' },
      { type: 'searchCallsAtMost', n: 3 },
    ],
    rubric: { file: 'groundedness.v2.md', dimension: 'groundedness' },
  },
  {
    id: '02',
    title: 'Honest miss — no KB coverage → report_inability, no fabrication',
    roles: ['customer_support'],
    surface: 'widget',
    // Only an unrelated article exists, so retrieval surfaces nothing relevant.
    fixtures: { kbArticles: [OFFICE_HOURS_ARTICLE] },
    prompt:
      'Do you offer a hardware trade-in program where I can send back an old industrial forklift for credit?',
    structural: [
      { type: 'status', oneOf: ['cannot_answer'] },
      { type: 'inability' },
      { type: 'noCitations' },
    ],
  },
  {
    id: '03',
    title: 'Search-budget stop — never loops to the iteration cap',
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: { kbArticles: [OFFICE_HOURS_ARTICLE] },
    prompt:
      'What is the exact SLA uptime percentage guaranteed in the enterprise contract, and the penalty schedule for each breach tier?',
    structural: [
      { type: 'searchCallsAtMost', n: 3 },
      { type: 'status', oneOf: ['answered', 'cannot_answer'] },
    ],
  },
  {
    id: '04',
    title: 'Paraphrase — semantic match with little keyword overlap',
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: { kbArticles: [EXPORT_ARTICLE] },
    prompt: 'How can I get an offline copy of everything I have saved so far?',
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'minCitations', n: 1 },
      { type: 'searchCallsAtMost', n: 3 },
    ],
    rubric: { file: 'groundedness.v2.md', dimension: 'groundedness' },
  },
  {
    id: '05',
    title: 'Multi-turn follow-up — answer depends on earlier thread context',
    roles: ['customer_support'],
    surface: 'widget',
    fixtures: { kbArticles: [REFUND_ARTICLE] },
    thread: [
      { sender: 'customer', content: 'I bought a subscription three weeks ago.' },
      {
        sender: 'assistant',
        content: 'Thanks for letting me know. How can I help with your subscription?',
      },
      { sender: 'customer', content: 'Can I still get my money back for it?' },
    ],
    structural: [
      { type: 'status', oneOf: ['answered'] },
      { type: 'searchCallsAtMost', n: 3 },
    ],
    rubric: { file: 'groundedness.v2.md', dimension: 'groundedness' },
  },
]
