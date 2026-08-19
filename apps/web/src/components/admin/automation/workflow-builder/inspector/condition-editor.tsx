/**
 * The condition step's rule editor. A thin, backward-compatible name over
 * RuleGroupBuilder (rule-group-builder.tsx) — the shared implementation also
 * consumed by branch paths (branch-editor.tsx, via this same component) and
 * the trigger's Audience section (trigger-editor.tsx, using
 * RuleGroupBuilder directly). See rule-group-builder.tsx's module doc for
 * the full rule-group / OR-of-groups contract.
 */
import { RuleGroupBuilder } from './rule-group-builder'
import type { GraphCondition } from '../../workflow-graph'

export function ConditionEditor({
  subject,
  condition,
  onChange,
}: {
  subject: string
  condition: GraphCondition
  onChange: (condition: GraphCondition) => void
}) {
  return <RuleGroupBuilder subject={subject} condition={condition} onChange={onChange} />
}
