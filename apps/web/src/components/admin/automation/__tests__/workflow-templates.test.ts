/**
 * Every workflow template must produce a structurally valid graph (the same
 * schema the server re-validates on save) and a trigger type the workflows
 * manager actually knows how to group and label.
 */
import { describe, it, expect } from 'vitest'
import {
  workflowGraphSchema,
  classRestrictedNodeIssue,
} from '@/lib/server/domains/workflows/workflow.schemas'
import {
  collectStepIssues,
  graphToTree,
  NEEDS_SETUP_PREFIX,
  TRIGGER_TYPES,
} from '../workflow-graph'
import { WORKFLOW_TEMPLATES, workflowTemplatesByCategory } from '../workflow-templates'

describe('WORKFLOW_TEMPLATES', () => {
  it.each(WORKFLOW_TEMPLATES)('$id has a graph that passes workflowGraphSchema', (template) => {
    const result = workflowGraphSchema.safeParse(template.payload.graph)
    expect(result.success, result.success ? undefined : JSON.stringify(result.error?.issues)).toBe(
      true
    )
  })

  // Phase C, slice C-6: a parking block (reply_buttons/collect_data/
  // collect_reply/request_csat/let_assistant_answer/disable_composer) is only
  // legal in a customer_facing workflow (see workflow.schemas.ts's
  // classRestrictedNodeIssue) — every shipped template must already satisfy
  // this, since the server refuses to save one that doesn't.
  it.each(WORKFLOW_TEMPLATES)('$id passes the class-rule check for parking blocks', (template) => {
    const issue = classRestrictedNodeIssue(template.payload.graph, template.payload.class)
    expect(issue).toBeNull()
  })

  it.each(WORKFLOW_TEMPLATES)('$id uses a known trigger type', (template) => {
    expect(TRIGGER_TYPES).toContain(template.payload.triggerType)
  })

  // Bumped from 8 by the Phase C, slice C-5 launch templates (front-door
  // triage bot, AI-first support, post-resolution follow-up) — see
  // PHASE-C-CONVERSATIONAL-UX-BRIEF.md §9.
  it('has between 4 and 12 templates', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(4)
    expect(WORKFLOW_TEMPLATES.length).toBeLessThanOrEqual(12)
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
    expect(popular.length).toBeGreaterThan(0)
    for (const template of popular) {
      expect(template.categories).toContain('popular')
    }
  })

  // Templates can't ship real team/policy ids, so they use needs-setup
  // placeholders. Those must read as unresolved step issues — that's what
  // drives the list's "Needs setup" badge and the builder's issues chip.
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

  it('has at least one template that ships needing setup', () => {
    const withPlaceholders = WORKFLOW_TEMPLATES.filter((t) =>
      JSON.stringify(t.payload.graph).includes(NEEDS_SETUP_PREFIX)
    )
    expect(withPlaceholders.length).toBeGreaterThan(0)
  })

  // AI-ATTRIBUTES-PARITY-SPEC.md Phase 2 routing templates: option ids are
  // minted per-workspace at random (packages/db/drizzle/0178_ai_attribute_detection.sql),
  // so a branch/condition that decides on one can only ship unset -- an `eq`
  // leaf with an empty value, the degraded placeholder the builder already
  // renders as unresolved (ruleSummary's `value || '…'` fallback). These
  // assertions pin that shape so a future template author doesn't
  // accidentally hardcode an option id that will never exist in a real
  // workspace.
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

    it('route-by-issue-type branches on conversation.attr.issue_type with unset eq placeholders', () => {
      const template = WORKFLOW_TEMPLATES.find((t) => t.id === 'route-by-issue-type')
      expect(template).toBeDefined()
      const attrLeaves = allConditions(template!)
        .flatMap((c) => leaves(c))
        .filter((l) => l.field === 'conversation.attr.issue_type')
      expect(attrLeaves.length).toBeGreaterThanOrEqual(2)
      for (const leaf of attrLeaves) {
        expect(leaf.op).toBe('eq')
        expect(leaf.value).toBe('')
      }
      expect(template!.payload.triggerType).toBe('assistant.handed_off')
      expect(template!.benefit.toLowerCase()).toContain('ai attribute detection')
    })

    it('escalate-frustrated-customers gates on conversation.attr.sentiment with an unset eq placeholder', () => {
      const template = WORKFLOW_TEMPLATES.find((t) => t.id === 'escalate-frustrated-customers')
      expect(template).toBeDefined()
      const attrLeaves = allConditions(template!)
        .flatMap((c) => leaves(c))
        .filter((l) => l.field === 'conversation.attr.sentiment')
      expect(attrLeaves).toEqual([{ field: 'conversation.attr.sentiment', op: 'eq', value: '' }])
      expect(template!.payload.triggerType).toBe('assistant.handed_off')
      expect(template!.benefit.toLowerCase()).toContain('ai attribute detection')
    })
  })

  // Phase C, slice C-5 launch templates (PHASE-C-CONVERSATIONAL-UX-BRIEF.md
  // §9): the conversational block layer's flagship templates. Every one uses
  // at least one new block kind, and every needs-setup ref (team/policy/tag/
  // attribute) must still demand setup through the same gate the pre-existing
  // action refs use.
  describe('conversational block launch templates', () => {
    const byId = (id: string) => {
      const t = WORKFLOW_TEMPLATES.find((tpl) => tpl.id === id)
      expect(t, `missing template ${id}`).toBeDefined()
      return t!
    }

    it('front-door-triage-bot is the hero card: popular + customer_facing, customer_facing class', () => {
      const t = byId('front-door-triage-bot')
      expect(t.categories).toEqual(expect.arrayContaining(['popular', 'customer_facing']))
      expect(t.payload.class).toBe('customer_facing')
      const kinds = t.payload.graph.nodes.map((n) => n.type)
      for (const expected of [
        'message',
        'reply_buttons',
        'let_assistant_answer',
        'collect_data',
        'show_reply_time',
      ]) {
        expect(kinds, `expected a ${expected} node`).toContain(expected)
      }
    })

    it('ai-first-support hands the turn to Quinn with an honest escalation path', () => {
      const t = byId('ai-first-support')
      expect(t.categories).toContain('customer_facing')
      const kinds = t.payload.graph.nodes.map((n) => n.type)
      expect(kinds).toContain('let_assistant_answer')
      expect(kinds).toContain('request_csat')
      // The escalated edge off let_assistant_answer is present and labeled.
      const escalatedEdge = t.payload.graph.edges.find(
        (e) => e.branch === 'escalated' && e.from === 'quinn_answer'
      )
      expect(escalatedEdge).toBeDefined()
    })

    it('post-resolution-follow-up is customer_facing (Phase C, slice C-6): its request_csat parks the run, so only a customer_facing run is reachable to resume it', () => {
      const t = byId('post-resolution-follow-up')
      expect(t.payload.class).toBe('customer_facing')
      expect(t.payload.graph.nodes.some((n) => n.type === 'request_csat')).toBe(true)
    })

    it('auto-close-idle stays background: it never uses a parking block kind', () => {
      const t = byId('auto-close-idle')
      expect(t.payload.class).toBe('background')
      const parkingKinds = new Set([
        'reply_buttons',
        'collect_data',
        'collect_reply',
        'request_csat',
        'let_assistant_answer',
        'disable_composer',
      ])
      expect(t.payload.graph.nodes.some((n) => parkingKinds.has(n.type))).toBe(false)
    })

    it.each(['front-door-triage-bot', 'ai-first-support'])(
      '%s: every needs-setup ref is flagged by the issues gate',
      (id) => {
        const t = byId(id)
        const tree = graphToTree(t.payload.graph)
        expect(tree.ok, tree.ok ? undefined : tree.error).toBe(true)
        if (!tree.ok) return
        const issues = collectStepIssues(tree.value)
        expect(issues.size).toBeGreaterThan(0)
      }
    )

    it('post-resolution-follow-up has no workspace refs to set up — ready to go live as-is', () => {
      const t = byId('post-resolution-follow-up')
      const tree = graphToTree(t.payload.graph)
      expect(tree.ok, tree.ok ? undefined : tree.error).toBe(true)
      if (!tree.ok) return
      expect(collectStepIssues(tree.value).size).toBe(0)
    })

    it('auto-close-idle now includes the nudge message before closing', () => {
      const t = byId('auto-close-idle')
      expect(t.payload.graph.nodes.some((n) => n.type === 'message')).toBe(true)
      expect(t.payload.graph.nodes.map((n) => n.type)).toContain('wait')
    })
  })
})
