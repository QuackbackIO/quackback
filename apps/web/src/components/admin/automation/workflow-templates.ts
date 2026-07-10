/**
 * Starter templates for the workflow gallery (support platform §4.6). Each
 * template is a ready-to-create workflow: the payload shape matches
 * `createWorkflowFn`'s input exactly, so the gallery just forwards it to
 * `useCreateWorkflow`. Graphs are hand-built against the node/edge shapes in
 * `workflow-graph.ts` and must stay valid against `workflowGraphSchema` (see
 * `__tests__/workflow-templates.test.ts`).
 *
 * Some templates reference a team, SLA policy, or tag that only exists in a
 * real workspace. Those fields can't be left blank -- the schema requires a
 * non-empty id -- so they ship with an obvious placeholder id (e.g.
 * "needs-setup-team") instead of a real one. The created workflow stays a
 * draft until someone opens it in the builder and points the step at a real
 * team, policy, or tag.
 *
 * The AI-attribute-detection routing templates below (AI-ATTRIBUTES-PARITY-
 * SPEC.md Phase 2) hit the same problem one level deeper: `conversation.attr.*`
 * branch conditions need an OPTION id, and those are minted per-workspace at
 * random by the seed migration (packages/db/drizzle/0178_ai_attribute_detection.sql)
 * -- there is no fixed id a template could ship with, and (unlike team/SLA/tag
 * refs) the graph model has no needs-setup-style placeholder slot for a
 * condition VALUE, only for action refs (`actionIssue` in workflow-graph.ts
 * checks actions, not conditions). The degraded fallback the builder already
 * renders correctly: an `eq` condition with `value: ''` — `ruleSummary`
 * displays it as "… " (an obviously unset choice) and the condition editor's
 * option picker opens on nothing selected, so the user must pick the real
 * option before the branch can ever match. Each such template's `benefit`/
 * step summary calls this out explicitly.
 */
import type { ComponentType, SVGProps } from 'react'
import {
  ArrowsRightLeftIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  FaceFrownIcon,
  FunnelIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import {
  NEEDS_SETUP_PREFIX,
  type BlockBody,
  type TriggerType,
  type WorkflowGraphJson,
} from './workflow-graph'

export type WorkflowTemplateCategory =
  | 'popular'
  | 'routing'
  | 'sla'
  | 'housekeeping'
  | 'customer_facing'

export const WORKFLOW_TEMPLATE_CATEGORIES: {
  key: WorkflowTemplateCategory
  label: string
}[] = [
  { key: 'popular', label: 'Popular' },
  { key: 'customer_facing', label: 'Customer facing' },
  { key: 'routing', label: 'Routing' },
  { key: 'sla', label: 'SLA & priority' },
  { key: 'housekeeping', label: 'Housekeeping' },
]

export interface WorkflowTemplatePayload {
  name: string
  class: 'customer_facing' | 'background'
  triggerType: TriggerType
  triggerSettings?: Record<string, unknown>
  graph: WorkflowGraphJson
}

export interface WorkflowTemplate {
  id: string
  title: string
  /** One-line benefit shown as a small pill on the card. */
  benefit: string
  categories: WorkflowTemplateCategory[]
  icon: ComponentType<SVGProps<SVGSVGElement>>
  iconClassName: string
  /** Short "step 1 · step 2" footer summarizing the graph. */
  stepsSummary: string
  payload: WorkflowTemplatePayload
}

/** Placeholder ids for fields that need a real workspace value before the
 *  workflow can go live. Built on NEEDS_SETUP_PREFIX so `actionIssue` reads
 *  them as unset and the list/builder surface a "Needs setup" issue. */
const NEEDS_SETUP_TEAM = `${NEEDS_SETUP_PREFIX}team`
const NEEDS_SETUP_POLICY = `${NEEDS_SETUP_PREFIX}sla-policy`
const NEEDS_SETUP_TAG = `${NEEDS_SETUP_PREFIX}tag`
/** Same problem one level deeper for the conversational block layer's
 *  collect_data steps (Phase C, slice C-5): the attribute it writes into is
 *  as workspace-specific as a team/policy/tag, so it ships unset too. */
const NEEDS_SETUP_ATTRIBUTE = `${NEEDS_SETUP_PREFIX}attribute`

/** A one-paragraph rich-text body for a conversational block's prompt. */
function body(text: string): BlockBody {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'route-to-team',
    title: 'Route conversations to the right team',
    benefit: 'Speed up support',
    categories: ['popular', 'routing'],
    icon: ArrowsRightLeftIcon,
    iconClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    stepsSummary: 'Branch on message body · Assign to team',
    payload: {
      name: 'Route conversations to the right team',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'branch_topic',
            type: 'branch',
            branches: [
              {
                key: 'billing',
                condition: { field: 'message.body', op: 'contains', value: 'billing' },
              },
              { key: 'everything_else', condition: {} },
            ],
          },
          {
            id: 'assign_billing',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'assign_support',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
        ],
        edges: [
          { from: 'trigger', to: 'branch_topic' },
          { from: 'branch_topic', to: 'assign_billing', branch: 'billing' },
          { from: 'branch_topic', to: 'assign_support', branch: 'everything_else' },
        ],
      },
    },
  },
  {
    id: 'sla-by-priority',
    title: 'Apply SLAs by priority',
    benefit: 'Never miss a target',
    categories: ['popular', 'sla'],
    icon: ShieldCheckIcon,
    iconClassName: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    stepsSummary: 'Branch on priority · Apply SLA policy',
    payload: {
      name: 'Apply SLAs by priority',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'branch_priority',
            type: 'branch',
            branches: [
              {
                key: 'high_priority',
                condition: { field: 'conversation.priority', op: 'eq', value: 'high' },
              },
              { key: 'everything_else', condition: {} },
            ],
          },
          {
            id: 'apply_priority_sla',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
          {
            id: 'apply_standard_sla',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
        ],
        edges: [
          { from: 'trigger', to: 'branch_priority' },
          { from: 'branch_priority', to: 'apply_priority_sla', branch: 'high_priority' },
          { from: 'branch_priority', to: 'apply_standard_sla', branch: 'everything_else' },
        ],
      },
    },
  },
  {
    id: 'escalate-long-waits',
    title: 'Escalate long waits',
    benefit: 'Catch slow replies',
    categories: ['sla', 'housekeeping'],
    icon: ClockIcon,
    iconClassName: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    stepsSummary: 'Wait 30m · Check waiting time · Set priority · Assign to team',
    payload: {
      name: 'Escalate long waits',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'wait_30m', type: 'wait', seconds: 1800 },
          {
            id: 'still_waiting',
            type: 'condition',
            condition: { field: 'conversation.waiting_minutes', op: 'gte', value: 30 },
          },
          {
            id: 'set_priority_high',
            type: 'action',
            action: { type: 'set_priority', priority: 'high' },
          },
          {
            id: 'assign_escalation_team',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
        ],
        edges: [
          { from: 'trigger', to: 'wait_30m' },
          { from: 'wait_30m', to: 'still_waiting' },
          { from: 'still_waiting', to: 'set_priority_high' },
          { from: 'set_priority_high', to: 'assign_escalation_team' },
        ],
      },
    },
  },
  {
    id: 'auto-close-idle',
    title: 'Auto-close idle conversations',
    benefit: 'Keep the inbox clean',
    categories: ['housekeeping'],
    icon: XCircleIcon,
    iconClassName: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    // Phase C, slice C-5: a nudge message now precedes the close, so a
    // customer who's simply gone quiet gets one more honest chance to reply
    // before the conversation closes out from under them.
    stepsSummary: 'Wait 3 days · Nudge message · Wait 2 days · Close conversation',
    payload: {
      name: 'Auto-close idle conversations',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'wait_3_days', type: 'wait', seconds: 259_200 },
          { id: 'nudge_message', type: 'message', body: body('Still stuck? Just reply.') },
          { id: 'wait_2_days', type: 'wait', seconds: 172_800 },
          { id: 'close_conversation', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'wait_3_days' },
          { from: 'wait_3_days', to: 'nudge_message' },
          { from: 'nudge_message', to: 'wait_2_days' },
          { from: 'wait_2_days', to: 'close_conversation' },
        ],
      },
    },
  },
  {
    id: 'tag-billing-keywords',
    title: 'Tag billing keywords',
    benefit: 'Organize automatically',
    categories: ['routing', 'housekeeping'],
    icon: TagIcon,
    iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    stepsSummary: 'Condition · Add tag',
    payload: {
      name: 'Tag billing keywords',
      class: 'background',
      triggerType: 'message.created',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'mentions_billing',
            type: 'condition',
            condition: { field: 'message.body', op: 'contains', value: 'billing' },
          },
          { id: 'add_billing_tag', type: 'action', action: { type: 'add_tag', tagId: 'billing' } },
        ],
        edges: [
          { from: 'trigger', to: 'mentions_billing' },
          { from: 'mentions_billing', to: 'add_billing_tag' },
        ],
      },
    },
  },
  {
    id: 'route-by-issue-type',
    title: 'Route by issue type',
    // Phase C, slice C-5 copy review: reads as the no-bot sibling of "AI-first
    // support with honest escalation" — same routing intent, no conversational
    // block layer, for teams that want Quinn's classification without a bot
    // turn in front of it.
    benefit: 'Pairs with AI attribute detection — the no-bot alternative',
    categories: ['popular', 'routing'],
    icon: FunnelIcon,
    iconClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    stepsSummary: 'Branch on issue type (needs option setup) · Assign to team — no bot turn',
    payload: {
      name: 'Route by issue type',
      class: 'customer_facing',
      // Quinn classifies conversation.attr.issue_type at hand-off (Settings >
      // Conversation data > "Let Quinn detect") — this branches on it the
      // moment Quinn hands off, the standard pattern for routing rules that
      // act on an AI-classified attribute.
      triggerType: 'assistant.handed_off',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'branch_issue_type',
            type: 'branch',
            branches: [
              // Option ids are minted per-workspace (see the module doc), so
              // these ship unset ('eq' with an empty value) — open each
              // branch in the builder and choose the real "Billing" /
              // "Bug report" option before setting this live.
              {
                key: 'billing',
                condition: { field: 'conversation.attr.issue_type', op: 'eq', value: '' },
              },
              {
                key: 'bug_report',
                condition: { field: 'conversation.attr.issue_type', op: 'eq', value: '' },
              },
              { key: 'everything_else', condition: {} },
            ],
          },
          {
            id: 'assign_billing',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'set_priority_bug',
            type: 'action',
            action: { type: 'set_priority', priority: 'high' },
          },
          {
            id: 'assign_bug',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'assign_other',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
        ],
        edges: [
          { from: 'trigger', to: 'branch_issue_type' },
          { from: 'branch_issue_type', to: 'assign_billing', branch: 'billing' },
          { from: 'branch_issue_type', to: 'set_priority_bug', branch: 'bug_report' },
          { from: 'set_priority_bug', to: 'assign_bug' },
          { from: 'branch_issue_type', to: 'assign_other', branch: 'everything_else' },
        ],
      },
    },
  },
  {
    id: 'escalate-frustrated-customers',
    title: 'Escalate frustrated customers',
    benefit: 'Pairs with AI attribute detection',
    categories: ['popular', 'sla'],
    icon: FaceFrownIcon,
    iconClassName: 'bg-red-500/10 text-red-600 dark:text-red-400',
    stepsSummary: 'Condition on sentiment (needs option setup) · Set priority · Apply SLA',
    payload: {
      name: 'Escalate frustrated customers',
      class: 'background',
      // Quinn classifies conversation.attr.sentiment at hand-off. Background
      // (not customer_facing/exclusive) so it can run alongside a routing
      // workflow on the same trigger instead of competing for the one
      // exclusive slot.
      triggerType: 'assistant.handed_off',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'is_negative_sentiment',
            type: 'condition',
            // Ships unset — open this gate in the builder and choose the
            // real "Negative" option (see the module doc on why a fixed
            // option id can't ship in the template).
            condition: { field: 'conversation.attr.sentiment', op: 'eq', value: '' },
          },
          {
            id: 'set_priority_urgent',
            type: 'action',
            action: { type: 'set_priority', priority: 'urgent' },
          },
          {
            id: 'apply_escalation_sla',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
        ],
        edges: [
          { from: 'trigger', to: 'is_negative_sentiment' },
          { from: 'is_negative_sentiment', to: 'set_priority_urgent' },
          { from: 'set_priority_urgent', to: 'apply_escalation_sla' },
        ],
      },
    },
  },
  // ── Conversational block layer launch templates (Phase C, slice C-5) ─────
  // UX-BRIEF.md §9. The gallery's hero card: greet, triage via buttons, hand
  // the "product question" path to Quinn with an honest human escalation,
  // collect structured detail on the other paths. Every workspace ref (team,
  // SLA policy, attribute) ships as a needs-setup sentinel per this module's
  // established convention.
  {
    id: 'front-door-triage-bot',
    title: 'Front-door triage bot',
    benefit: 'Greets, triages, and routes — no teammate needed up front',
    categories: ['popular', 'customer_facing'],
    icon: ChatBubbleLeftRightIcon,
    iconClassName: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
    stepsSummary: 'Welcome message · Reply buttons · Let Quinn answer / Collect data · Route',
    payload: {
      name: 'Front-door triage bot',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      triggerSettings: { channels: ['messenger'] },
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'welcome_message',
            type: 'message',
            body: body('Hi {first_name|there}! What can we help with today?'),
          },
          {
            id: 'triage_buttons',
            type: 'reply_buttons',
            body: body('Choose the option that fits best:'),
            allowTyping: false,
            options: [
              { key: 'product', label: 'Product question' },
              { key: 'bug', label: 'Report a bug' },
              { key: 'billing', label: 'Billing' },
              { key: 'sales', label: 'Talk to sales' },
            ],
          },
          // [Product question] -> let Quinn answer -> escalated -> route by
          // Quinn's own conversation.attr.issue_type classification.
          { id: 'quinn_answer', type: 'let_assistant_answer' },
          {
            id: 'branch_issue_type',
            type: 'branch',
            branches: [
              {
                key: 'billing_issue',
                condition: { field: 'conversation.attr.issue_type', op: 'eq', value: '' },
              },
              {
                key: 'bug_issue',
                condition: { field: 'conversation.attr.issue_type', op: 'eq', value: '' },
              },
              { key: 'everything_else', condition: {} },
            ],
          },
          {
            id: 'assign_billing_from_quinn',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'assign_bug_from_quinn',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'assign_other_from_quinn',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          // [Report a bug] -> collect the affected area -> ack -> prioritize -> route -> SLA.
          {
            id: 'collect_bug_area',
            type: 'collect_data',
            body: body('Which area is this about?'),
            attributeKey: NEEDS_SETUP_ATTRIBUTE,
            fieldType: 'select',
            options: [],
            required: true,
          },
          { id: 'bug_ack', type: 'message', body: body("Thanks — we've logged the details.") },
          {
            id: 'set_priority_bug',
            type: 'action',
            action: { type: 'set_priority', priority: 'high' },
          },
          {
            id: 'assign_bug_team',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'apply_bug_sla',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
          // [Billing] -> route -> SLA -> show the reply-time line.
          {
            id: 'assign_billing_team',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'apply_billing_sla',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
          { id: 'show_billing_reply_time', type: 'show_reply_time' },
          // [Talk to sales] -> collect an email -> tag -> route -> ack.
          {
            id: 'collect_sales_email',
            type: 'collect_data',
            body: body("What's the best email to reach you?"),
            attributeKey: NEEDS_SETUP_ATTRIBUTE,
            fieldType: 'text',
            required: true,
          },
          {
            id: 'add_sales_tag',
            type: 'action',
            action: { type: 'add_tag', tagId: NEEDS_SETUP_TAG },
          },
          {
            id: 'assign_sales_team',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'sales_ack',
            type: 'message',
            body: body('Thanks! Our sales team will reach out shortly.'),
          },
        ],
        edges: [
          { from: 'trigger', to: 'welcome_message' },
          { from: 'welcome_message', to: 'triage_buttons' },
          { from: 'triage_buttons', to: 'quinn_answer', branch: 'product' },
          { from: 'quinn_answer', to: 'branch_issue_type', branch: 'escalated' },
          { from: 'branch_issue_type', to: 'assign_billing_from_quinn', branch: 'billing_issue' },
          { from: 'branch_issue_type', to: 'assign_bug_from_quinn', branch: 'bug_issue' },
          { from: 'branch_issue_type', to: 'assign_other_from_quinn', branch: 'everything_else' },
          { from: 'triage_buttons', to: 'collect_bug_area', branch: 'bug' },
          { from: 'collect_bug_area', to: 'bug_ack' },
          { from: 'bug_ack', to: 'set_priority_bug' },
          { from: 'set_priority_bug', to: 'assign_bug_team' },
          { from: 'assign_bug_team', to: 'apply_bug_sla' },
          { from: 'triage_buttons', to: 'assign_billing_team', branch: 'billing' },
          { from: 'assign_billing_team', to: 'apply_billing_sla' },
          { from: 'apply_billing_sla', to: 'show_billing_reply_time' },
          { from: 'triage_buttons', to: 'collect_sales_email', branch: 'sales' },
          { from: 'collect_sales_email', to: 'add_sales_tag' },
          { from: 'add_sales_tag', to: 'assign_sales_team' },
          { from: 'assign_sales_team', to: 'sales_ack' },
        ],
      },
    },
  },
  {
    id: 'ai-first-support',
    title: 'AI-first support with honest escalation',
    benefit: 'Let Quinn try first — CSAT-checked, honestly escalated',
    categories: ['customer_facing'],
    icon: SparklesIcon,
    iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    stepsSummary: 'Let Quinn answer · Wait · Ask for a rating / Escalate on sentiment',
    payload: {
      name: 'AI-first support with honest escalation',
      class: 'customer_facing',
      // No "first message only" condition primitive exists yet (CONDITION_FIELDS
      // has no message-count/is-first field) — conversation.created fires once
      // per conversation, the closest available equivalent to the brief's
      // "message.created, first message" and simpler to reason about besides.
      triggerType: 'conversation.created',
      triggerSettings: { channels: ['messenger'] },
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'quinn_answer', type: 'let_assistant_answer' },
          // Resolved (default) path: pause briefly, then ask how it went.
          { id: 'wait_before_csat', type: 'wait', seconds: 120 },
          {
            id: 'ask_csat',
            type: 'request_csat',
            body: body('How did that go?'),
            allowTypingInterrupt: true,
          },
          // Rating <= 2: apologize, reopen, assign, tag (own copy per rating
          // so the graph stays merge-free / tree-representable — see this
          // module's report for why request_csat can't share one downstream
          // node across multiple rating keys without losing canvas
          // editability). The reopen is load-bearing, not decorative: by the
          // time this path runs, the conversation is already `closed` —
          // `quinn_answer`'s default (non-escalated) edge only ever resumes
          // because Quinn's own end_conversation tool closed it (see
          // event-trigger.ts's tryResumeAssistantWait), so without reopening
          // first, assign/tag would silently land a teammate on a closed
          // conversation instead of an active queue.
          {
            id: 'apology_low_1',
            type: 'message',
            body: body("We're sorry that didn't help — a teammate is picking this up."),
          },
          { id: 'reopen_low_1', type: 'action', action: { type: 'reopen' } },
          {
            id: 'assign_low_1',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          { id: 'tag_low_1', type: 'action', action: { type: 'add_tag', tagId: NEEDS_SETUP_TAG } },
          {
            id: 'apology_low_2',
            type: 'message',
            body: body("We're sorry that didn't help — a teammate is picking this up."),
          },
          { id: 'reopen_low_2', type: 'action', action: { type: 'reopen' } },
          {
            id: 'assign_low_2',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          { id: 'tag_low_2', type: 'action', action: { type: 'add_tag', tagId: NEEDS_SETUP_TAG } },
          // Rating >= 3: a simple thanks (own copy per rating, same reason).
          {
            id: 'thanks_3',
            type: 'message',
            body: body('Glad that helped — thanks for the rating!'),
          },
          {
            id: 'thanks_4',
            type: 'message',
            body: body('Glad that helped — thanks for the rating!'),
          },
          {
            id: 'thanks_5',
            type: 'message',
            body: body('Glad that helped — thanks for the rating!'),
          },
          // Escalated path: Quinn couldn't resolve it — branch on sentiment.
          {
            id: 'branch_sentiment',
            type: 'branch',
            branches: [
              {
                key: 'negative',
                condition: { field: 'conversation.attr.sentiment', op: 'eq', value: '' },
              },
              { key: 'everything_else', condition: {} },
            ],
          },
          {
            id: 'set_priority_negative',
            type: 'action',
            action: { type: 'set_priority', priority: 'urgent' },
          },
          {
            id: 'apply_sla_negative',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
          {
            id: 'assign_negative',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'assign_neutral',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          { id: 'show_reply_time_neutral', type: 'show_reply_time' },
        ],
        edges: [
          { from: 'trigger', to: 'quinn_answer' },
          { from: 'quinn_answer', to: 'wait_before_csat' },
          { from: 'wait_before_csat', to: 'ask_csat' },
          { from: 'ask_csat', to: 'apology_low_1', branch: '1' },
          { from: 'apology_low_1', to: 'reopen_low_1' },
          { from: 'reopen_low_1', to: 'assign_low_1' },
          { from: 'assign_low_1', to: 'tag_low_1' },
          { from: 'ask_csat', to: 'apology_low_2', branch: '2' },
          { from: 'apology_low_2', to: 'reopen_low_2' },
          { from: 'reopen_low_2', to: 'assign_low_2' },
          { from: 'assign_low_2', to: 'tag_low_2' },
          { from: 'ask_csat', to: 'thanks_3', branch: '3' },
          { from: 'ask_csat', to: 'thanks_4', branch: '4' },
          { from: 'ask_csat', to: 'thanks_5', branch: '5' },
          { from: 'quinn_answer', to: 'branch_sentiment', branch: 'escalated' },
          { from: 'branch_sentiment', to: 'set_priority_negative', branch: 'negative' },
          { from: 'set_priority_negative', to: 'apply_sla_negative' },
          { from: 'apply_sla_negative', to: 'assign_negative' },
          { from: 'branch_sentiment', to: 'assign_neutral', branch: 'everything_else' },
          { from: 'assign_neutral', to: 'show_reply_time_neutral' },
        ],
      },
    },
  },
  {
    id: 'post-resolution-follow-up',
    title: 'Post-resolution follow-up',
    benefit: 'A quiet CSAT check once a conversation closes',
    categories: ['housekeeping'],
    icon: ClockIcon,
    iconClassName: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    stepsSummary: 'Closed · Wait 2 minutes · Ask for a rating',
    payload: {
      name: 'Post-resolution follow-up',
      // customer_facing, not background (Phase C, slice C-6): request_csat
      // PARKS the run awaiting the customer's rating, and only a
      // customer_facing run is ever reachable to resume (event-trigger.ts's
      // findWaitingCustomerFacingRun + the customer_facing exclusive lock
      // both only look at that class — see workflow.schemas.ts's
      // classRestrictedNodeIssue). A background run parked here would be
      // unreachable and park forever. By the time this workflow's trigger
      // (conversation.status_changed -> closed) fires, whatever
      // triage/routing workflow owned the conversation has already finished
      // or been interrupted (a closed conversation has nothing left running
      // customer-facing), so this template doesn't compete for the exclusive
      // slot in practice even though it's no longer background.
      class: 'customer_facing',
      triggerType: 'conversation.status_changed',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'is_closed',
            type: 'condition',
            condition: { field: 'conversation.status', op: 'eq', value: 'closed' },
          },
          { id: 'wait_2m', type: 'wait', seconds: 120 },
          {
            id: 'ask_csat',
            type: 'request_csat',
            body: body('How did we do?'),
            allowTypingInterrupt: true,
          },
        ],
        edges: [
          { from: 'trigger', to: 'is_closed' },
          { from: 'is_closed', to: 'wait_2m' },
          { from: 'wait_2m', to: 'ask_csat' },
        ],
      },
    },
  },
]

export function workflowTemplatesByCategory(
  category: WorkflowTemplateCategory
): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.filter((t) => t.categories.includes(category))
}
