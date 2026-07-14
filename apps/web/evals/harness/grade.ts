/**
 * Structural grading (§7.4 tier 1): deterministic, free, non-flaky. Every
 * assertion reads only the turn result + captured tool ledger, never the model
 * again. Returns a list of human-readable failures ([] = pass).
 */
import type { AssistantTurnResult } from '@/lib/server/domains/assistant/assistant.runtime'
import type {
  AssistantCitation,
  AssistantProposedAction,
  AssistantToolOutcome,
} from '@/lib/server/domains/assistant/assistant.toolspec'
import type { Structural } from '../types'

export interface TurnCapture {
  kind: 'turn'
  result: AssistantTurnResult
  /** Tool outcomes recorded this run (from result.trace.toolCalls). */
  toolOutcomes: AssistantToolOutcome[]
  citations: AssistantCitation[]
  proposedActions: AssistantProposedAction[]
  text: string
  internalSourced: boolean
  handoffReason: string | null
  inabilityReason: string | null
}

export interface ToolsetCapture {
  kind: 'toolset'
  toolNames: string[]
}

export type Capture = TurnCapture | ToolsetCapture

function searchCallCount(outcomes: AssistantToolOutcome[]): number {
  return outcomes.filter((o) => o.name === 'search_knowledge').length
}

function gradeOne(a: Structural, cap: Capture): string | null {
  if (cap.kind === 'toolset') {
    switch (a.type) {
      case 'toolPresent':
        return cap.toolNames.includes(a.name)
          ? null
          : `expected tool "${a.name}" present, got [${cap.toolNames.join(', ')}]`
      case 'toolAbsent':
        return cap.toolNames.includes(a.name)
          ? `expected tool "${a.name}" absent, got [${cap.toolNames.join(', ')}]`
          : null
      default:
        return `assertion "${a.type}" is not valid for a toolset scenario`
    }
  }

  const { result, toolOutcomes, citations, proposedActions, text } = cap
  switch (a.type) {
    case 'status':
      return a.oneOf.includes(result.status)
        ? null
        : `expected status ∈ [${a.oneOf.join(', ')}], got "${result.status}"`
    case 'suppressed':
      return result.status === 'suppressed' ? null : `expected suppressed, got "${result.status}"`
    case 'toolCallsAtMost':
      return toolOutcomes.length <= a.n
        ? null
        : `expected ≤${a.n} tool calls, got ${toolOutcomes.length} [${toolOutcomes.map((o) => o.name).join(', ')}]`
    case 'toolCallCount':
      return toolOutcomes.length === a.n
        ? null
        : `expected exactly ${a.n} tool calls, got ${toolOutcomes.length} [${toolOutcomes.map((o) => o.name).join(', ')}]`
    case 'searchCallsAtMost': {
      const n = searchCallCount(toolOutcomes)
      return n <= a.n ? null : `expected ≤${a.n} search calls, got ${n}`
    }
    case 'minCitations':
      return citations.length >= a.n ? null : `expected ≥${a.n} citations, got ${citations.length}`
    case 'noCitations':
      return citations.length === 0 ? null : `expected 0 citations, got ${citations.length}`
    case 'citesType': {
      const ofType = citations.filter((c) => c.type === a.citationType)
      if (ofType.length === 0) {
        return `expected a "${a.citationType}" citation, got [${citations.map((c) => c.type).join(', ') || 'none'}]`
      }
      if (a.internal !== undefined && !ofType.some((c) => (c.internal ?? false) === a.internal)) {
        return `expected a "${a.citationType}" citation with internal=${a.internal}, got internal flags [${ofType.map((c) => String(c.internal ?? false)).join(', ')}]`
      }
      return null
    }
    case 'excludesCitationType': {
      const ofType = citations.filter((c) => c.type === a.citationType)
      return ofType.length === 0
        ? null
        : `expected no "${a.citationType}" citations, got ${ofType.length}`
    }
    case 'citationsSubsetOfLedger': {
      // The runtime drops any cited id not in the run ledger (assembleCitations)
      // and throws `fabricated_citation` if the model insists — so a returned
      // result already satisfies the subset property. Assert well-formedness so
      // a malformed/empty id surfaces here rather than silently.
      const bad = citations.filter((c) => !c.id || !c.type)
      return bad.length === 0
        ? null
        : `citations must all carry a ledger-backed id+type; ${bad.length} malformed`
    }
    case 'handoff': {
      const escalated = 'escalation' in result && result.escalation != null
      if (!escalated) return `expected a handoff, got none (status "${result.status}")`
      if (a.reasonOneOf && cap.handoffReason && !a.reasonOneOf.includes(cap.handoffReason)) {
        return `expected handoff reason ∈ [${a.reasonOneOf.join(', ')}], got "${cap.handoffReason}"`
      }
      return null
    }
    case 'inability': {
      if (result.status !== 'cannot_answer') {
        return `expected an inability (cannot_answer), got "${result.status}"`
      }
      if (a.reasonOneOf && cap.inabilityReason && !a.reasonOneOf.includes(cap.inabilityReason)) {
        return `expected inability reason ∈ [${a.reasonOneOf.join(', ')}], got "${cap.inabilityReason}"`
      }
      return null
    }
    case 'internalSourced':
      return cap.internalSourced === a.value
        ? null
        : `expected internalSourced=${a.value}, got ${cap.internalSourced}`
    case 'noWrites': {
      const writes = toolOutcomes.filter(
        (o) => o.outcome === 'executed' || o.outcome === 'proposed'
      )
      if (writes.length > 0) {
        return `expected no writes, got [${writes.map((o) => `${o.name}:${o.outcome}`).join(', ')}]`
      }
      return proposedActions.length === 0
        ? null
        : `expected no proposed actions, got ${proposedActions.length}`
    }
    case 'noProposals':
      return proposedActions.length === 0
        ? null
        : `expected no proposed actions, got [${proposedActions.map((p) => p.toolName).join(', ')}]`
    case 'executedTool':
      return toolOutcomes.some((o) => o.name === a.name && o.outcome === 'executed')
        ? null
        : `expected "${a.name}" to execute; outcomes: [${toolOutcomes.map((o) => `${o.name}:${o.outcome}`).join(', ')}]`
    case 'proposedTool':
      return proposedActions.some((p) => p.toolName === a.name)
        ? null
        : `expected "${a.name}" proposed; proposals: [${proposedActions.map((p) => p.toolName).join(', ')}]`
    case 'textIncludesAny': {
      const lower = text.toLowerCase()
      return a.values.some((v) => lower.includes(v.toLowerCase()))
        ? null
        : `expected text to include one of [${a.values.join(', ')}]`
    }
    case 'textExcludesAll': {
      const lower = text.toLowerCase()
      const hit = a.values.find((v) => lower.includes(v.toLowerCase()))
      return hit ? `expected text to exclude "${hit}"` : null
    }
    case 'toolPresent':
    case 'toolAbsent':
      return `assertion "${a.type}" is only valid for a toolset scenario`
    default:
      return `unknown assertion "${(a as { type: string }).type}"`
  }
}

/** Grade every assertion; returns the list of failure messages ([] = pass). */
export function gradeStructural(assertions: Structural[], cap: Capture): string[] {
  return assertions.map((a) => gradeOne(a, cap)).filter((f): f is string => f !== null)
}
