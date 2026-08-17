/**
 * Starter templates for the workflow gallery. Each payload matches
 * `createWorkflowFn` and must stay valid against `workflowGraphSchema`.
 *
 * Workspace-specific refs (team, SLA, tag, attribute, option id) ship as
 * needs-setup sentinels or empty option values — never as a bare literal
 * that looks live. See `assertTemplateRefsAreSentinels`.
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
  StarIcon,
  TicketIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import {
  countSetupIssues,
  graphToTree,
  isNeedsSetupRef,
  NEEDS_SETUP_PREFIX,
  triggerLabel,
  type BlockBody,
  type GraphAction,
  type GraphCondition,
  type TriggerType,
  type WorkflowGraphJson,
} from './workflow-graph'

export type WorkflowTemplateCategory =
  'popular' | 'routing' | 'sla' | 'housekeeping' | 'customer_facing'

export const WORKFLOW_TEMPLATE_CATEGORIES: {
  key: WorkflowTemplateCategory
  label: string
  labelId: string
}[] = [
  { key: 'popular', label: 'Popular', labelId: 'automation.templates.cat.popular' },
  {
    key: 'customer_facing',
    label: 'Customer facing',
    labelId: 'automation.templates.cat.customerFacing',
  },
  { key: 'routing', label: 'Routing', labelId: 'automation.templates.cat.routing' },
  { key: 'sla', label: 'SLA & priority', labelId: 'automation.templates.cat.sla' },
  { key: 'housekeeping', label: 'Housekeeping', labelId: 'automation.templates.cat.housekeeping' },
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
  /** One-line benefit under the title. */
  benefit: string
  categories: WorkflowTemplateCategory[]
  icon: ComponentType<SVGProps<SVGSVGElement>>
  iconClassName: string
  payload: WorkflowTemplatePayload
}

const NEEDS_SETUP_TEAM = `${NEEDS_SETUP_PREFIX}team`
const NEEDS_SETUP_POLICY = `${NEEDS_SETUP_PREFIX}sla-policy`
const NEEDS_SETUP_TAG = `${NEEDS_SETUP_PREFIX}tag`
const NEEDS_SETUP_ATTRIBUTE = `${NEEDS_SETUP_PREFIX}attribute`

/** Catch-all branch path: always true, so it is not a "pick an option" hole. */
const CATCH_ALL: GraphCondition = { field: 'conversation.status', op: 'is_set' }

function body(text: string): BlockBody {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function unsetAttr(key: string): GraphCondition {
  return { field: `conversation.attr.${key}`, op: 'eq', value: '' }
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'front-door-triage-bot',
    title: 'Front-door triage bot',
    benefit: 'Greets, triages, and routes. No teammate needed up front.',
    categories: ['popular', 'customer_facing'],
    icon: ChatBubbleLeftRightIcon,
    iconClassName: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
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
          { id: 'quinn_answer', type: 'let_assistant_answer' },
          {
            id: 'branch_issue_type',
            type: 'branch',
            branches: [
              { key: 'billing_issue', condition: unsetAttr('issue_type') },
              { key: 'bug_issue', condition: unsetAttr('issue_type') },
              { key: 'everything_else', condition: CATCH_ALL },
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
          {
            id: 'collect_bug_area',
            type: 'collect_data',
            body: body('Which area is this about?'),
            attributeKey: NEEDS_SETUP_ATTRIBUTE,
            fieldType: 'select',
            options: [],
            required: true,
          },
          { id: 'convert_bug', type: 'action', action: { type: 'convert_to_ticket' } },
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
          { from: 'collect_bug_area', to: 'convert_bug' },
          { from: 'convert_bug', to: 'bug_ack' },
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
    id: 'route-by-issue-type',
    title: 'Route by issue type',
    benefit: 'Quinn classifies, the workflow routes. The modern pattern.',
    categories: ['popular', 'routing'],
    icon: FunnelIcon,
    iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    payload: {
      name: 'Route by issue type',
      class: 'background',
      triggerType: 'assistant.handed_off',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'branch_issue_type',
            type: 'branch',
            branches: [
              { key: 'billing', condition: unsetAttr('issue_type') },
              { key: 'bug_report', condition: unsetAttr('issue_type') },
              { key: 'everything_else', condition: CATCH_ALL },
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
    id: 'after-hours-front-door',
    title: 'After-hours front door',
    benefit: 'Set honest expectations and capture a way to reply when the team is away.',
    categories: ['popular', 'customer_facing'],
    icon: ClockIcon,
    iconClassName: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    payload: {
      name: 'After-hours front door',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      triggerSettings: { channels: ['messenger'] },
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'outside_hours',
            type: 'condition',
            condition: { field: 'office_hours', op: 'eq', value: false },
          },
          {
            id: 'hours_message',
            type: 'message',
            body: body(
              "Thanks for writing in — the team is away right now. We'll pick this up when we're back."
            ),
          },
          { id: 'show_reply_time', type: 'show_reply_time' },
          {
            id: 'missing_email',
            type: 'condition',
            condition: { field: 'person.email', op: 'is_empty' },
          },
          {
            id: 'collect_email',
            type: 'collect_data',
            body: body("What's the best email to reach you?"),
            attributeKey: NEEDS_SETUP_ATTRIBUTE,
            fieldType: 'text',
            required: true,
          },
        ],
        edges: [
          { from: 'trigger', to: 'outside_hours' },
          { from: 'outside_hours', to: 'hours_message' },
          { from: 'hours_message', to: 'show_reply_time' },
          { from: 'show_reply_time', to: 'missing_email' },
          { from: 'missing_email', to: 'collect_email' },
        ],
      },
    },
  },
  {
    id: 'rescue-approaching-breaches',
    title: 'Rescue approaching breaches',
    benefit: 'Bump priority and pull in the escalation team before an SLA slips.',
    categories: ['popular', 'sla'],
    icon: ShieldCheckIcon,
    iconClassName: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    payload: {
      name: 'Rescue approaching breaches',
      class: 'background',
      triggerType: 'sla.approaching_breach',
      triggerSettings: { breachLeadMinutes: 15 },
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'set_priority_urgent',
            type: 'action',
            action: { type: 'set_priority', priority: 'urgent' },
          },
          {
            id: 'assign_escalation',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
        ],
        edges: [
          { from: 'trigger', to: 'set_priority_urgent' },
          { from: 'set_priority_urgent', to: 'assign_escalation' },
        ],
      },
    },
  },
  {
    id: 'handoff-triage',
    title: 'Handoff triage',
    benefit:
      'When Quinn hands off: frustrated customers jump the queue, platform errors page the right team.',
    categories: ['popular'],
    icon: FaceFrownIcon,
    iconClassName: 'bg-red-500/10 text-red-600 dark:text-red-400',
    payload: {
      name: 'Handoff triage',
      class: 'background',
      triggerType: 'assistant.handed_off',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'branch_handoff',
            type: 'branch',
            branches: [
              {
                key: 'platform_error',
                condition: unsetAttr('assistant_escalation_reason'),
              },
              { key: 'frustrated', condition: unsetAttr('sentiment') },
              { key: 'everything_else', condition: CATCH_ALL },
            ],
          },
          {
            id: 'error_priority',
            type: 'action',
            action: { type: 'set_priority', priority: 'urgent' },
          },
          {
            id: 'error_assign',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'frustrated_priority',
            type: 'action',
            action: { type: 'set_priority', priority: 'urgent' },
          },
          {
            id: 'frustrated_sla',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
        ],
        edges: [
          { from: 'trigger', to: 'branch_handoff' },
          { from: 'branch_handoff', to: 'error_priority', branch: 'platform_error' },
          { from: 'error_priority', to: 'error_assign' },
          { from: 'branch_handoff', to: 'frustrated_priority', branch: 'frustrated' },
          { from: 'frustrated_priority', to: 'frustrated_sla' },
        ],
      },
    },
  },
  {
    id: 'ai-first-support',
    title: 'AI-first support with honest escalation',
    benefit: 'Let Quinn try first — CSAT-checked, honestly escalated.',
    categories: ['customer_facing'],
    icon: SparklesIcon,
    iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    payload: {
      name: 'AI-first support with honest escalation',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      triggerSettings: { channels: ['messenger'] },
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'quinn_answer', type: 'let_assistant_answer' },
          { id: 'wait_before_csat', type: 'wait', seconds: 600 },
          {
            id: 'ask_csat',
            type: 'request_csat',
            body: body('How did that go?'),
            allowTypingInterrupt: true,
          },
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
          {
            id: 'branch_sentiment',
            type: 'branch',
            branches: [
              { key: 'negative', condition: unsetAttr('sentiment') },
              { key: 'everything_else', condition: CATCH_ALL },
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
    id: 'vip-concierge-lane',
    title: 'VIP concierge lane',
    benefit: 'Fast-track your best accounts. Adjust the audience to your real plan attribute.',
    categories: ['customer_facing', 'routing'],
    icon: StarIcon,
    iconClassName: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    payload: {
      name: 'VIP concierge lane',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      triggerSettings: {
        channels: ['messenger'],
        audience: { field: 'company.attr.plan', op: 'eq', value: 'enterprise' },
      },
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'set_priority_high',
            type: 'action',
            action: { type: 'set_priority', priority: 'high' },
          },
          {
            id: 'apply_vip_sla',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
          {
            id: 'assign_concierge_team',
            type: 'action',
            action: { type: 'assign_team', teamId: NEEDS_SETUP_TEAM },
          },
          {
            id: 'concierge_message',
            type: 'message',
            body: body(
              "Hi {first_name|there} — you've reached our priority line. A specialist is on it."
            ),
          },
        ],
        edges: [
          { from: 'trigger', to: 'set_priority_high' },
          { from: 'set_priority_high', to: 'apply_vip_sla' },
          { from: 'apply_vip_sla', to: 'assign_concierge_team' },
          { from: 'assign_concierge_team', to: 'concierge_message' },
        ],
      },
    },
  },
  {
    id: 'route-by-keywords',
    title: 'Route by keywords',
    benefit: 'The no-AI fallback: branch on words in the first message.',
    categories: ['routing'],
    icon: ArrowsRightLeftIcon,
    iconClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    payload: {
      name: 'Route by keywords',
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
              { key: 'everything_else', condition: CATCH_ALL },
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
    id: 'prioritize-by-ai-urgency',
    title: 'Prioritize by AI urgency',
    benefit: 'React when Quinn marks a conversation urgent — the signal that exists at intake.',
    categories: ['sla'],
    icon: SparklesIcon,
    iconClassName: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    payload: {
      name: 'Prioritize by AI urgency',
      class: 'background',
      triggerType: 'conversation.attribute_changed',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'is_urgent',
            type: 'condition',
            condition: unsetAttr('urgency'),
          },
          {
            id: 'set_priority_urgent',
            type: 'action',
            action: { type: 'set_priority', priority: 'urgent' },
          },
          {
            id: 'apply_urgent_sla',
            type: 'action',
            action: { type: 'apply_sla', policyId: NEEDS_SETUP_POLICY },
          },
        ],
        edges: [
          { from: 'trigger', to: 'is_urgent' },
          { from: 'is_urgent', to: 'set_priority_urgent' },
          { from: 'set_priority_urgent', to: 'apply_urgent_sla' },
        ],
      },
    },
  },
  {
    id: 'auto-close-idle',
    title: 'Auto-close idle conversations',
    benefit: 'Nudge after the customer goes quiet, then close if silence continues.',
    categories: ['housekeeping'],
    icon: XCircleIcon,
    iconClassName: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    payload: {
      name: 'Auto-close idle conversations',
      class: 'background',
      triggerType: 'conversation.customer_unresponsive',
      triggerSettings: { inactivityMinutes: 3 * 24 * 60 },
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'nudge_message', type: 'message', body: body('Still stuck? Just reply.') },
          { id: 'wait_2_days', type: 'wait', seconds: 172_800 },
          {
            id: 'close_conversation',
            type: 'action',
            action: { type: 'close', lifecycle: 'auto_closed' },
          },
        ],
        edges: [
          { from: 'trigger', to: 'nudge_message' },
          { from: 'nudge_message', to: 'wait_2_days' },
          { from: 'wait_2_days', to: 'close_conversation' },
        ],
      },
    },
  },
  {
    id: 'post-resolution-follow-up',
    title: 'Post-resolution follow-up',
    benefit: 'A quiet CSAT check once a conversation closes.',
    categories: ['housekeeping'],
    icon: ClockIcon,
    iconClassName: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    payload: {
      name: 'Post-resolution follow-up',
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
  {
    id: 'close-the-loop-ticket',
    title: 'Close the loop when a ticket ships',
    benefit: 'Tell the customer when the bug they reported is done.',
    categories: ['housekeeping'],
    icon: TicketIcon,
    iconClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    payload: {
      name: 'Close the loop when a ticket ships',
      class: 'background',
      triggerType: 'ticket.status_changed',
      triggerSettings: { ticketStatusCategory: 'closed' },
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          {
            id: 'shipped_message',
            type: 'message',
            body: body('The fix you reported has shipped. Thanks for flagging it.'),
          },
          { id: 'close_conversation', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'shipped_message' },
          { from: 'shipped_message', to: 'close_conversation' },
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

export function workflowTemplateCategoryCount(category: WorkflowTemplateCategory): number {
  return workflowTemplatesByCategory(category).length
}

const ACTION_REF_KEYS = ['teamId', 'policyId', 'tagId', 'statusId', 'ticketTypeId'] as const

/** Fail if a template action points at a workspace row with a bare literal. */
export function assertTemplateRefsAreSentinels(template: WorkflowTemplate): string[] {
  const bad: string[] = []
  for (const node of template.payload.graph.nodes) {
    if (node.type === 'action') {
      const action = node.action as GraphAction & Record<string, unknown>
      for (const key of ACTION_REF_KEYS) {
        const value = action[key]
        if (typeof value === 'string' && value.length > 0 && !isNeedsSetupRef(value)) {
          bad.push(`${node.id}.${key}=${value}`)
        }
      }
    }
    if (
      (node.type === 'collect_data' || node.type === 'collect_reply') &&
      typeof node.attributeKey === 'string' &&
      node.attributeKey.length > 0 &&
      !isNeedsSetupRef(node.attributeKey)
    ) {
      bad.push(`${node.id}.attributeKey=${node.attributeKey}`)
    }
  }
  return bad
}

export type TemplateChipKind = 'trigger' | 'class' | 'prereq' | 'setup' | 'note'

export interface TemplateGalleryChip {
  kind: TemplateChipKind
  label: string
}

export function templateNeedsQuinn(template: WorkflowTemplate): boolean {
  return template.payload.graph.nodes.some((n) => n.type === 'let_assistant_answer')
}

export function templateNeedsInboxAi(template: WorkflowTemplate): boolean {
  return JSON.stringify(template.payload.graph).includes('conversation.attr.')
}

export function templateUsesOfficeHours(template: WorkflowTemplate): boolean {
  return JSON.stringify(template.payload.graph).includes('"office_hours"')
}

function countActionType(template: WorkflowTemplate, type: GraphAction['type']): number {
  return template.payload.graph.nodes.filter((n) => {
    if (n.type !== 'action' || n.action.type !== type) return false
    if (n.action.type === 'assign_team') return isNeedsSetupRef(n.action.teamId)
    if (n.action.type === 'apply_sla') return isNeedsSetupRef(n.action.policyId)
    if (n.action.type === 'add_tag') return isNeedsSetupRef(n.action.tagId)
    return false
  }).length
}

export function templateGalleryChips(
  template: WorkflowTemplate,
  ctx: { quinnOn: boolean; inboxAiOn: boolean }
): TemplateGalleryChip[] {
  const chips: TemplateGalleryChip[] = [
    { kind: 'trigger', label: triggerLabel(template.payload.triggerType) },
  ]
  if (template.payload.class === 'customer_facing') {
    chips.push({ kind: 'class', label: 'Customer facing' })
  } else {
    chips.push({ kind: 'class', label: 'Background' })
  }

  if (templateNeedsQuinn(template) && !ctx.quinnOn) {
    chips.push({ kind: 'prereq', label: 'Needs Quinn on' })
  }
  if (templateNeedsInboxAi(template) && !ctx.inboxAiOn) {
    chips.push({ kind: 'prereq', label: 'Needs Inbox AI' })
  }
  if (templateUsesOfficeHours(template)) {
    chips.push({ kind: 'note', label: 'Uses office hours' })
  }

  const tree = graphToTree(template.payload.graph)
  const options = tree.ok
    ? countSetupIssues(tree.value, template.payload.class, {
        audience: template.payload.triggerSettings?.audience as GraphCondition | undefined,
      }).branchOptions
    : 0
  if (options > 0) {
    chips.push({
      kind: 'setup',
      label: options === 1 ? '1 option to pick' : `${options} options to pick`,
    })
  }
  const teams = countActionType(template, 'assign_team')
  if (teams > 0) {
    chips.push({
      kind: 'setup',
      label: teams === 1 ? '1 team to pick' : `${teams} teams to pick`,
    })
  }
  const policies = countActionType(template, 'apply_sla')
  if (policies > 0) {
    chips.push({
      kind: 'setup',
      label: policies === 1 ? '1 policy to pick' : `${policies} policies to pick`,
    })
  }
  const tags = countActionType(template, 'add_tag')
  if (tags > 0) {
    chips.push({
      kind: 'setup',
      label: tags === 1 ? '1 tag to pick' : `${tags} tags to pick`,
    })
  }
  return chips
}
