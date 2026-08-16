/**
 * Every workflow template must produce a structurally valid graph and a
 * trigger the manager can label. Refs must be sentinels, never bare literals.
 */
import { describe, it, expect } from 'vitest'
import {
  workflowGraphSchema,
  classRestrictedNodeIssue,
  triggerSettingsSchema,
} from '@/lib/server/domains/workflows/workflow.schemas'
import {
  collectStepIssues,
  countSetupIssues,
  graphToTree,
  NEEDS_SETUP_PREFIX,
  TRIGGER_TYPES,
} from '../workflow-graph'
import {
  WORKFLOW_TEMPLATES,
  assertTemplateRefsAreSentinels,
  templateGalleryChips,
  templateNeedsInboxAi,
  templateNeedsQuinn,
  workflowTemplatesByCategory,
} from '../workflow-templates'

describe('WORKFLOW_TEMPLATES', () => {
  it.each(WORKFLOW_TEMPLATES)('$id has a graph that passes workflowGraphSchema', (template) => {
    const result = workflowGraphSchema.safeParse(template.payload.graph)
    expect(result.success, result.success ? undefined : JSON.stringify(result.error?.issues)).toBe(
      true
    )
  })

  it.each(WORKFLOW_TEMPLATES)('$id passes the class-rule check for parking blocks', (template) => {
    const issue = classRestrictedNodeIssue(template.payload.graph, template.payload.class)
    expect(issue).toBeNull()
  })

  it.each(WORKFLOW_TEMPLATES)('$id uses a known trigger type', (template) => {
    expect(TRIGGER_TYPES).toContain(template.payload.triggerType)
  })

  it.each(WORKFLOW_TEMPLATES.filter((t) => t.payload.triggerSettings))(
    '$id triggerSettings passes triggerSettingsSchema',
    (template) => {
      const result = triggerSettingsSchema.safeParse(template.payload.triggerSettings)
      expect(
        result.success,
        result.success ? undefined : JSON.stringify(result.error?.issues)
      ).toBe(true)
    }
  )

  it('has the 12 refined templates', () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(12)
  })

  it('gives every template a unique id', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('places every template in at least one category', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.categories.length).toBeGreaterThan(0)
    }
  })

  it('filters templates by category', () => {
    const popular = workflowTemplatesByCategory('popular')
    expect(popular.map((t) => t.id)).toEqual([
      'front-door-triage-bot',
      'route-by-issue-type',
      'after-hours-front-door',
      'rescue-approaching-breaches',
      'handoff-triage',
    ])
  })

  it('never ships a workspace ref as a bare literal', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(assertTemplateRefsAreSentinels(template), template.id).toEqual([])
    }
  })

  it('flags needs-setup placeholder refs as step issues', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const graphJson = JSON.stringify(template.payload.graph)
      if (!graphJson.includes(NEEDS_SETUP_PREFIX)) continue
      const tree = graphToTree(template.payload.graph)
      expect(tree.ok).toBe(true)
      if (tree.ok) {
        expect(
          collectStepIssues(tree.value).size,
          `${template.id} should need setup`
        ).toBeGreaterThan(0)
      }
    }
  })

  it('dropped the keyword-tag template that used a bare tag id', () => {
    expect(WORKFLOW_TEMPLATES.find((t) => t.id === 'tag-billing-keywords')).toBeUndefined()
  })
})

describe('AI attribute routing templates', () => {
  function leaves(condition: unknown): { field: string; op: string; value?: unknown }[] {
    if (!condition || typeof condition !== 'object') return []
    if ('field' in condition) return [condition as { field: string; op: string; value?: unknown }]
    const group = condition as { all?: unknown[]; any?: unknown[] }
    return [...(group.all ?? []), ...(group.any ?? [])].flatMap((c) => leaves(c))
  }

  function allConditions(template: (typeof WORKFLOW_TEMPLATES)[number]): unknown[] {
    const conditions: unknown[] = []
    for (const node of template.payload.graph.nodes) {
      if (node.type === 'condition') conditions.push(node.condition)
      if (node.type === 'branch') conditions.push(...node.branches.map((b) => b.condition))
    }
    return conditions
  }

  it('route-by-issue-type branches on issue_type with unset eq placeholders', () => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === 'route-by-issue-type')
    expect(template).toBeDefined()
    const attrLeaves = allConditions(template!)
      .flatMap((c) => leaves(c))
      .filter((l) => l.field === 'conversation.attr.issue_type')
    expect(attrLeaves.length).toBe(2)
    for (const leaf of attrLeaves) {
      expect(leaf.op).toBe('eq')
      expect(leaf.value).toBe('')
    }
    expect(template!.payload.triggerType).toBe('assistant.handed_off')
    expect(template!.payload.class).toBe('background')
    const tree = graphToTree(template!.payload.graph)
    expect(tree.ok).toBe(true)
    if (tree.ok) {
      expect(countSetupIssues(tree.value, 'background').branchOptions).toBe(2)
    }
  })

  it('handoff-triage has a sentiment lane and an escalation-reason lane', () => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === 'handoff-triage')
    expect(template).toBeDefined()
    const fields = allConditions(template!)
      .flatMap((c) => leaves(c))
      .map((l) => l.field)
    expect(fields).toContain('conversation.attr.sentiment')
    expect(fields).toContain('conversation.attr.assistant_escalation_reason')
    expect(template!.payload.triggerType).toBe('assistant.handed_off')
    expect(template!.payload.class).toBe('background')
  })

  it('prioritize-by-ai-urgency reacts to the urgency attribute', () => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === 'prioritize-by-ai-urgency')
    expect(template).toBeDefined()
    expect(template!.payload.triggerType).toBe('conversation.attribute_changed')
    expect(template!.payload.class).toBe('background')
    const attrLeaves = allConditions(template!)
      .flatMap((c) => leaves(c))
      .filter((l) => l.field === 'conversation.attr.urgency')
    expect(attrLeaves).toEqual([{ field: 'conversation.attr.urgency', op: 'eq', value: '' }])
  })
})

describe('conversational and new primitives', () => {
  const byId = (id: string) => {
    const t = WORKFLOW_TEMPLATES.find((tpl) => tpl.id === id)
    expect(t, `missing template ${id}`).toBeDefined()
    return t!
  }

  it('front-door-triage-bot converts the bug path to a ticket', () => {
    const t = byId('front-door-triage-bot')
    expect(t.categories).toEqual(expect.arrayContaining(['popular', 'customer_facing']))
    expect(t.payload.class).toBe('customer_facing')
    const convert = t.payload.graph.nodes.find(
      (n) => n.type === 'action' && n.action.type === 'convert_to_ticket'
    )
    expect(convert).toBeDefined()
    expect(
      t.payload.graph.edges.some((e) => e.from === 'collect_bug_area' && e.to === 'convert_bug')
    ).toBe(true)
  })

  it('ai-first-support hands the turn to Quinn with an honest escalation path', () => {
    const t = byId('ai-first-support')
    expect(t.categories).toContain('customer_facing')
    const kinds = t.payload.graph.nodes.map((n) => n.type)
    expect(kinds).toContain('let_assistant_answer')
    expect(kinds).toContain('request_csat')
    const escalatedEdge = t.payload.graph.edges.find(
      (e) => e.branch === 'escalated' && e.from === 'quinn_answer'
    )
    expect(escalatedEdge).toBeDefined()
  })

  it('post-resolution-follow-up is customer_facing because request_csat parks', () => {
    const t = byId('post-resolution-follow-up')
    expect(t.payload.class).toBe('customer_facing')
    expect(t.payload.graph.nodes.some((n) => n.type === 'request_csat')).toBe(true)
    const tree = graphToTree(t.payload.graph)
    expect(tree.ok).toBe(true)
    if (tree.ok) expect(collectStepIssues(tree.value).size).toBe(0)
  })

  it('auto-close-idle uses the unresponsive-customer trigger', () => {
    const t = byId('auto-close-idle')
    expect(t.payload.class).toBe('background')
    expect(t.payload.triggerType).toBe('conversation.customer_unresponsive')
    expect(t.payload.triggerSettings?.inactivityMinutes).toBe(3 * 24 * 60)
    expect(t.payload.graph.nodes.some((n) => n.type === 'message')).toBe(true)
    expect(t.payload.graph.nodes.map((n) => n.type)).toContain('wait')
  })

  it('after-hours-front-door uses office hours, reply time, and email capture', () => {
    const t = byId('after-hours-front-door')
    expect(t.payload.class).toBe('customer_facing')
    const kinds = t.payload.graph.nodes.map((n) => n.type)
    expect(kinds).toContain('show_reply_time')
    expect(kinds).toContain('collect_data')
    const hours = t.payload.graph.nodes.find(
      (n) => n.type === 'condition' && n.id === 'outside_hours'
    )
    expect(hours && hours.type === 'condition' && hours.condition).toEqual({
      field: 'office_hours',
      op: 'eq',
      value: false,
    })
  })

  it('rescue-approaching-breaches uses the native SLA trigger', () => {
    const t = byId('rescue-approaching-breaches')
    expect(t.payload.triggerType).toBe('sla.approaching_breach')
    expect(t.payload.class).toBe('background')
  })

  it('close-the-loop-ticket fires when a linked ticket closes', () => {
    const t = byId('close-the-loop-ticket')
    expect(t.payload.triggerType).toBe('ticket.status_changed')
    expect(t.payload.triggerSettings?.ticketStatusCategory).toBe('closed')
    expect(t.payload.graph.nodes.some((n) => n.type === 'message')).toBe(true)
    expect(
      t.payload.graph.nodes.some((n) => n.type === 'action' && n.action.type === 'close')
    ).toBe(true)
  })

  it('route-by-keywords is the renamed no-AI fallback', () => {
    const t = byId('route-by-keywords')
    expect(t.title).toBe('Route by keywords')
    expect(t.payload.triggerType).toBe('conversation.created')
  })
})

describe('vip-concierge-lane', () => {
  const t = () => WORKFLOW_TEMPLATES.find((tpl) => tpl.id === 'vip-concierge-lane')!

  it('is customer_facing on conversation.created', () => {
    expect(t().payload.class).toBe('customer_facing')
    expect(t().payload.triggerType).toBe('conversation.created')
    expect(t().categories).toContain('customer_facing')
  })

  it('ships an audience condition gating on company.attr.plan', () => {
    const audience = t().payload.triggerSettings?.audience as
      | { field: string; op: string; value?: unknown }
      | undefined
    expect(audience).toEqual({ field: 'company.attr.plan', op: 'eq', value: 'enterprise' })
    expect(t().benefit.toLowerCase()).toContain('adjust')
  })
})

describe('templateGalleryChips', () => {
  it('hides Quinn/Inbox AI prereqs when the workspace already has them', () => {
    const front = WORKFLOW_TEMPLATES.find((t) => t.id === 'front-door-triage-bot')!
    expect(templateNeedsQuinn(front)).toBe(true)
    const off = templateGalleryChips(front, { quinnOn: false, inboxAiOn: false })
    expect(off.some((c) => c.label === 'Needs Quinn on')).toBe(true)
    const on = templateGalleryChips(front, { quinnOn: true, inboxAiOn: true })
    expect(on.some((c) => c.label === 'Needs Quinn on')).toBe(false)
    expect(on.some((c) => c.label === 'Needs Inbox AI')).toBe(false)
  })

  it('marks route-by-issue-type as needing Inbox AI and 2 options', () => {
    const t = WORKFLOW_TEMPLATES.find((tpl) => tpl.id === 'route-by-issue-type')!
    expect(templateNeedsInboxAi(t)).toBe(true)
    const chips = templateGalleryChips(t, { quinnOn: true, inboxAiOn: false })
    expect(chips.some((c) => c.label === 'Needs Inbox AI')).toBe(true)
    expect(chips.some((c) => c.label === '2 options to pick')).toBe(true)
  })
})
