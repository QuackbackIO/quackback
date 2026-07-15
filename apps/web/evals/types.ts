/**
 * Declarative scenario contract for the golden eval set (QUINN-TWO-AGENT-SPEC
 * §7.2). A scenario is data: fixtures to seed, a prompt/thread to send, and the
 * assertions that grade the outcome. The runner (harness/run.ts) expands each
 * role-tagged scenario across its applicable roles and evaluates it.
 *
 * Doctrine (§7.1): grade the artifact, not the path. Structural assertions are
 * deterministic code; the LLM judge is used ONLY where quality is the question
 * (tone/length contrast, groundedness, writing-guideline adherence).
 */
import type {
  AssistantRole,
  AssistantAgentKind,
  AssistantTone,
  AssistantResponseLength,
} from '@/lib/shared/assistant/config'
import type { AssistantSurface } from '@/lib/shared/assistant/surfaces'
import type { AssistantCitationType } from '@/lib/server/domains/assistant/citation-types'

export type { AssistantRole }

/** A turn in the fixture thread. `human_agent` exercises the silence rule. */
export interface ThreadMessage {
  sender: 'customer' | 'assistant' | 'human_agent'
  content: string
}

/** A KB article seeded (with a real embedding) for grounding scenarios. */
export interface SeedKbArticle {
  title: string
  content: string
  /** Public (Agent-visible) vs team-only (Copilot-only). Default: true. */
  isPublic?: boolean
}

/**
 * A closed-ticket resolution summary seeded (with a real embedding) for the
 * team-only ticket-grounding source (Quinn Phase 4). Backed by a throwaway
 * ticket + status the seeder creates to satisfy the FK.
 */
export interface SeedTicketSummary {
  summary: string
}

/**
 * A changelog entry seeded (with a real embedding) for the changelog-grounding
 * source (Quinn Phase 4). Published entries are customer-visible; a draft
 * (`published: false`) is team-only and trips the copilot leak gate.
 */
export interface SeedChangelogEntry {
  title: string
  content: string
  /** Published (customer-visible) vs draft (team-only). Default: true. */
  published?: boolean
}

/** A situational-guidance rule. `appliesWhen: null` = always-on. */
export interface SeedGuidance {
  name: string
  instruction: string
  appliesWhen?: string | null
  /** The single agent this rule targets (D4). Defaults to 'agent'. */
  agent?: AssistantAgentKind
  enabled?: boolean
  priority?: number
}

/** A conversation-attribute definition so `set_attribute` has a valid target. */
export interface SeedAttribute {
  key: string
  label: string
  fieldType?: 'text' | 'select'
  options?: { id: string; label: string }[]
}

/** Per-scenario workspace config the harness writes to the settings row. */
export interface ScenarioConfig {
  tone?: AssistantTone
  responseLength?: AssistantResponseLength
  additionalInstructions?: string
  /** settings.feature_flags.assistantTools — gates write-tool assembly. */
  assistantTools?: boolean
  /** settings.feature_flags.assistantKnowledge — extra Copilot sources. */
  assistantKnowledge?: boolean
}

export interface Fixtures {
  kbArticles?: SeedKbArticle[]
  /** Closed-ticket resolution summaries (team-only source; Phase 4). */
  ticketSummaries?: SeedTicketSummary[]
  /** Changelog entries, published or draft (Phase 4). */
  changelogEntries?: SeedChangelogEntry[]
  guidance?: SeedGuidance[]
  attributes?: SeedAttribute[]
  /**
   * Seed a real conversation + open involvement so a live write turn can
   * execute (scenario 21) or propose (scenario 22) against it. The turn is run
   * with the seeded conversationId/involvementId.
   */
  withConversation?: boolean
}

/**
 * One deterministic structural assertion (§7.4 tier 1). Interpreted by the
 * grader against the turn result + captured tool ledger.
 */
export type Structural =
  | { type: 'status'; oneOf: Array<'answered' | 'cannot_answer' | 'suppressed'> }
  | { type: 'suppressed' }
  | { type: 'toolCallsAtMost'; n: number }
  | { type: 'toolCallCount'; n: number }
  | { type: 'searchCallsAtMost'; n: number }
  | { type: 'minCitations'; n: number }
  | { type: 'noCitations' }
  | { type: 'citationsSubsetOfLedger' }
  /** At least one citation of this source type; when `internal` is given, at
   *  least one citation of that type must carry the matching internal flag. */
  | { type: 'citesType'; citationType: AssistantCitationType; internal?: boolean }
  /** No citation of this source type (a boundary/leak-gate assertion). */
  | { type: 'excludesCitationType'; citationType: AssistantCitationType }
  | { type: 'handoff'; reasonOneOf?: string[] }
  | { type: 'inability'; reasonOneOf?: string[] }
  | { type: 'internalSourced'; value: boolean }
  | { type: 'noWrites' }
  | { type: 'noProposals' }
  | { type: 'executedTool'; name: string }
  | { type: 'proposedTool'; name: string }
  | { type: 'textIncludesAny'; values: string[] }
  | { type: 'textExcludesAll'; values: string[] }
  // Toolset-kind assertions (evaluated against the assembled tool set, no model call):
  | { type: 'toolPresent'; name: string }
  | { type: 'toolAbsent'; name: string }

/** A versioned judge rubric (§7.4 tier 2). `file` is a path under evals/rubrics/. */
export interface RubricRef {
  file: string
  dimension: string
}

interface BaseScenario {
  id: string
  title: string
  /** The agent roles this scenario runs under (§7.3 role tagging). */
  roles: AssistantRole[]
  /** The customer-facing surface for `customer_support` (copilot roles force 'copilot'). */
  surface?: Exclude<AssistantSurface, 'copilot'>
  config?: ScenarioConfig
  fixtures?: Fixtures
  /** Judgment-variance handling (§7.3 #8): run N times, require a stability fraction. */
  repeats?: number
  /** Fraction of repeats that must fully pass (default 1). */
  stabilityThreshold?: number
}

/** Seed → runAssistantTurn → grade structural (+ optional single-turn judge). */
export interface TurnScenario extends BaseScenario {
  kind?: 'turn'
  thread?: ThreadMessage[]
  /** Convenience single customer message (becomes a one-message thread). */
  prompt?: string
  structural: Structural[]
  rubric?: RubricRef
}

/** Assert on the assembled tool set directly — deterministic, no model call. */
export interface ToolsetScenario extends BaseScenario {
  kind: 'toolset'
  structural: Structural[]
}

/** Run the same prompt under two configs and judge the contrast (§7.3 #15/#16). */
export interface ContrastScenario extends BaseScenario {
  kind: 'contrast'
  prompt: string
  variants: { label: string; config: ScenarioConfig }[]
  rubric: RubricRef
}

export type Scenario = TurnScenario | ToolsetScenario | ContrastScenario

/** Resolve the surface a given role runs on. */
export function surfaceForRole(scenario: BaseScenario, role: AssistantRole): AssistantSurface {
  if (role === 'copilot_qa' || role === 'suggested_reply') return 'copilot'
  return scenario.surface ?? 'widget'
}
