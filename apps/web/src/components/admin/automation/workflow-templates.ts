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
  ClockIcon,
  FaceFrownIcon,
  FunnelIcon,
  ShieldCheckIcon,
  TagIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { NEEDS_SETUP_PREFIX, type TriggerType, type WorkflowGraphJson } from './workflow-graph'

export type WorkflowTemplateCategory = 'popular' | 'routing' | 'sla' | 'housekeeping'

export const WORKFLOW_TEMPLATE_CATEGORIES: {
  key: WorkflowTemplateCategory
  label: string
}[] = [
  { key: 'popular', label: 'Popular' },
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
    categories: ['sla'],
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
    stepsSummary: 'Wait 3 days · Close conversation',
    payload: {
      name: 'Auto-close idle conversations',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'wait_3_days', type: 'wait', seconds: 259_200 },
          { id: 'close_conversation', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 'trigger', to: 'wait_3_days' },
          { from: 'wait_3_days', to: 'close_conversation' },
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
    benefit: 'Pairs with AI attribute detection',
    categories: ['popular', 'routing'],
    icon: FunnelIcon,
    iconClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    stepsSummary: 'Branch on issue type (needs option setup) · Assign to team',
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
]

export function workflowTemplatesByCategory(
  category: WorkflowTemplateCategory
): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.filter((t) => t.categories.includes(category))
}
