/**
 * The required checks a candidate has to pass before it can be published
 * (QUINN-PRODUCT Step 10, P7).
 *
 * Each check runs against an EXACT candidate: the configuration frozen in the
 * candidate's snapshot, never the live one. That is what makes a stored result
 * evidence about a particular candidate rather than about whatever the
 * workspace happened to look like when somebody pressed the button, and it is
 * why every result is stored with the candidate hash it was produced against.
 *
 * Two of them are deterministic and run anywhere. The third needs a live model
 * and is therefore reported rather than required: a provider outage must not be
 * able to decide whether a workspace may ship a wording change, and a check
 * that is skipped for want of a provider is exactly the "skipped scenario
 * cannot yield a green gate" case if it were required.
 *
 * The sandbox check runs through the same seam the Test Quinn page uses, so
 * there is one candidate sandbox rather than two: no conversation, no
 * involvement, `simulate` on, and therefore no inbox row and no dispatched
 * write whatever the candidate's dials say (the sandbox wins over a dial before
 * mode resolution: see `resolveEffectiveToolMode`).
 */
import { db } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import {
  assistantConfigSchema,
  migrateAssistantConfig,
  normalizeAssistantConfig,
  roleToAgent,
  type AssistantConfig,
} from '@/lib/shared/assistant/config'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import type { ReleaseCheckKey, ReleaseCheckStatus } from '@/lib/shared/assistant/release'
import { assembleAssistantToolset } from './assistant.tools'
import { makeAssistantToolContext } from './assistant.toolspec'
import { listConnectorToolSpecsForAgent } from './connectors/connector-tools'
import { resolveContentAudience } from './audience'
import { resolveAssistantKnowledgeSnapshot } from './retrieval-sources'
import {
  isAssistantConfigured,
  runAssistantTurn,
  type AssistantRuntimeConfig,
  type AssistantThreadMessage,
} from './assistant.runtime'
import { ensureAssistantPrincipal } from './assistant.principal'
import {
  gradeRegressionCase,
  listEnabledRegressionCases,
  type RegressionCaseVerdict,
} from './regression-cases.service'

const log = logger.child({ component: 'assistant-release-checks' })

export interface ReleaseCheckOutcome {
  status: ReleaseCheckStatus
  summary: string
  detail: Record<string, unknown>
}

/** The question the sample-answer check asks. Fixed, so two runs are comparable. */
const SANDBOX_PROBE = 'What can you help me with?'

/** Sandbox replies are read by a person, not stored as a transcript. */
const SANDBOX_TEXT_MAX_CHARS = 4000

export interface CandidateBehaviour {
  config: AssistantConfig
  configRevision: number
  workspaceName: string
  /** The live configuration this candidate would replace, for the managed-field comparison. */
  liveConfig: AssistantConfig | null
  managedFieldPaths: readonly string[]
}

function runtimeConfigFor(candidate: CandidateBehaviour): AssistantRuntimeConfig {
  return {
    config: candidate.config,
    revision: candidate.configRevision,
    workspaceName: candidate.workspaceName,
  }
}

/**
 * The candidate parses, normalizes to itself, and changes no managed field.
 *
 * The write funnel refuses a managed-path write already; this asserts the same
 * invariant about the candidate as a whole, which is the thing a publication
 * actually makes live.
 */
function checkConfiguration(candidate: CandidateBehaviour): ReleaseCheckOutcome {
  const parsed = assistantConfigSchema.safeParse(migrateAssistantConfig(candidate.config))
  if (!parsed.success) {
    return {
      status: 'failed',
      summary: 'The candidate configuration is not valid.',
      detail: { issues: parsed.error.issues.slice(0, 10).map((issue) => issue.path.join('.')) },
    }
  }
  const normalized = normalizeAssistantConfig(parsed.data)
  if (JSON.stringify(normalized) !== JSON.stringify(parsed.data)) {
    return {
      status: 'failed',
      summary: 'The candidate configuration does not match its normalized form.',
      detail: {},
    }
  }
  const managed = changedManagedPaths(candidate)
  if (managed.length > 0) {
    return {
      status: 'failed',
      summary: 'The candidate changes a setting your deployment manages.',
      detail: { managedPaths: managed.slice(0, 10) },
    }
  }
  return { status: 'passed', summary: 'Configuration is valid.', detail: {} }
}

function changedManagedPaths(candidate: CandidateBehaviour): string[] {
  if (!candidate.liveConfig || candidate.managedFieldPaths.length === 0) return []
  const changed = leafPaths(candidate.liveConfig, candidate.config)
  const managed = [...candidate.managedFieldPaths]
  return changed.filter((path) => isPathManaged(`assistant.${path}`, managed))
}

function leafPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (Object.is(before, after)) return []
  const beforeObject =
    typeof before === 'object' && before !== null && !Array.isArray(before)
      ? (before as Record<string, unknown>)
      : null
  const afterObject =
    typeof after === 'object' && after !== null && !Array.isArray(after)
      ? (after as Record<string, unknown>)
      : null
  if (!beforeObject || !afterObject) {
    if (!prefix) return []
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix]
  }
  const out: string[] = []
  for (const key of [
    ...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]),
  ].sort())
    out.push(...leafPaths(beforeObject[key], afterObject[key], prefix ? `${prefix}.${key}` : key))
  return out
}

/**
 * Both uses assemble a tool set under the candidate.
 *
 * Assembly is where a candidate's knowledge map, tool dials and connector state
 * meet, so a candidate that cannot be turned into a working tool set is one
 * nobody should publish. Dials naming a tool that is not in the assembled set
 * are reported rather than failed: a connector disabled for the afternoon is a
 * legitimate transient, and blocking a wording change on it would teach people
 * to ignore the gate.
 */
async function checkToolset(candidate: CandidateBehaviour): Promise<ReleaseCheckOutcome> {
  const assembled: Record<string, string[]> = {}
  const { id: assistantPrincipalId } = await ensureAssistantPrincipal()
  for (const role of ['customer_support', 'copilot_qa'] as const) {
    const surface = role === 'copilot_qa' ? 'copilot' : 'widget'
    const audience = resolveContentAudience(surface)
    const agent = roleToAgent(role)
    try {
      const ctx = makeAssistantToolContext({
        db,
        assistantPrincipalId,
        role,
        audience,
        conversationId: null,
        knowledge: resolveAssistantKnowledgeSnapshot(agent, candidate.config, audience),
        // No parent and no dispatch: this assembles the set, it never runs one.
        simulate: true,
        writeToolPolicy: 'simulate',
        skills: { count: 0, loads: 0 },
      })
      const { tools } = await assembleAssistantToolset(
        ctx,
        undefined,
        await listConnectorToolSpecsForAgent(agent, db)
      )
      assembled[agent] = tools.map((tool) => tool.name).sort()
    } catch (err) {
      log.warn({ err, agent }, 'candidate tool set did not assemble')
      return {
        status: 'failed',
        summary: `Actions could not be assembled for ${agent === 'agent' ? 'customer conversations' : 'support teammates'}.`,
        detail: { agent, error: err instanceof Error ? err.message : String(err) },
      }
    }
  }
  const unmatched: string[] = []
  for (const agent of ['agent', 'copilot'] as const) {
    for (const name of Object.keys(candidate.config.agents[agent].toolRules ?? {})) {
      if (!assembled[agent]?.includes(name)) unmatched.push(`${agent}.${name}`)
    }
  }
  return {
    status: 'passed',
    summary:
      unmatched.length > 0
        ? `Actions assemble. ${unmatched.length} rule${unmatched.length === 1 ? '' : 's'} name an action that is not available.`
        : 'Actions assemble for both uses.',
    detail: { tools: assembled, unmatchedRules: unmatched.slice(0, 10) },
  }
}

/**
 * One sandbox answer under the exact candidate.
 *
 * Optional by design. Without a configured model it records itself as skipped
 * with the reason, which is an honest absence rather than a silent pass.
 */
async function checkAnswerSandbox(candidate: CandidateBehaviour): Promise<ReleaseCheckOutcome> {
  if (!isAssistantConfigured()) {
    return {
      status: 'skipped',
      summary: 'No AI model is configured, so no answer could be produced.',
      detail: { reason: 'no_model' },
    }
  }
  let turn: Awaited<ReturnType<typeof runCandidateSandboxTurn>>
  try {
    turn = await runCandidateSandboxTurn({
      messages: [{ sender: 'customer', content: SANDBOX_PROBE }],
      candidate,
    })
  } catch (err) {
    return {
      status: 'inconclusive',
      summary: 'The sandbox turn could not be completed.',
      detail: { error: err instanceof Error ? err.message : String(err) },
    }
  }
  if (turn.status === 'suppressed') {
    return {
      status: 'failed',
      summary: 'The candidate produced no answer for a plain question.',
      detail: { status: turn.status, reason: turn.suppressedReason },
    }
  }
  if (turn.executedTools.length > 0) {
    return {
      status: 'failed',
      summary: 'The sandbox turn reported an executed action, which a sandbox must never do.',
      detail: { executedTools: turn.executedTools },
    }
  }
  return {
    status: 'passed',
    summary: 'The candidate answered a plain question in the sandbox.',
    detail: { status: turn.status, citations: turn.citations.length },
  }
}

/**
 * Every enabled regression case, run against the candidate and graded
 * structurally (QUINN-PRODUCT P8).
 *
 * The same sandbox seam the sample answer uses, so a case costs no conversation
 * row, no involvement and no transcript message, and every write tool previews
 * before any dial is consulted. Bounded at REGRESSION_CASE_RUN_LIMIT, because
 * each case is a real generation.
 *
 * A workspace with no cases is `skipped`, never `passed`: an empty suite is not
 * evidence, and the gate reads those two words very differently.
 */
async function checkRegressionCases(candidate: CandidateBehaviour): Promise<ReleaseCheckOutcome> {
  const cases = await listEnabledRegressionCases()
  if (cases.length === 0) {
    return {
      status: 'skipped',
      summary: 'No regression cases have been kept yet.',
      detail: { reason: 'no_cases' },
    }
  }
  if (!isAssistantConfigured()) {
    return {
      status: 'skipped',
      summary: 'No AI model is configured, so no case could be run.',
      detail: { reason: 'no_model', cases: cases.length },
    }
  }

  const verdicts: RegressionCaseVerdict[] = []
  for (const testCase of cases) {
    let turn: Awaited<ReturnType<typeof runCandidateSandboxTurn>>
    try {
      turn = await runCandidateSandboxTurn({
        messages: [{ sender: 'customer', content: testCase.question }],
        candidate,
      })
    } catch (err) {
      return {
        status: 'inconclusive',
        summary: 'A regression case could not be run.',
        detail: { case: testCase.title, error: err instanceof Error ? err.message : String(err) },
      }
    }
    verdicts.push(gradeRegressionCase(testCase, turn))
  }

  const failed = verdicts.filter((verdict) => !verdict.passed)
  return {
    status: failed.length === 0 ? 'passed' : 'failed',
    summary:
      failed.length === 0
        ? `All ${verdicts.length} regression cases still hold.`
        : `${failed.length} of ${verdicts.length} regression cases no longer hold.`,
    detail: { cases: verdicts },
  }
}

export async function runReleaseCheck(
  key: ReleaseCheckKey,
  candidate: CandidateBehaviour
): Promise<ReleaseCheckOutcome> {
  switch (key) {
    case 'configuration':
      return checkConfiguration(candidate)
    case 'toolset':
      return checkToolset(candidate)
    case 'answer_sandbox':
      return checkAnswerSandbox(candidate)
    case 'regression_cases':
      return checkRegressionCases(candidate)
    default: {
      const exhaustive: never = key
      throw new Error(`unknown release check "${String(exhaustive)}"`)
    }
  }
}

export interface SandboxTurnResult {
  status: 'answered' | 'cannot_answer' | 'suppressed'
  text: string
  citations: Array<{ type: string; id: string; internal: boolean }>
  /**
   * The turn's tool ledger, verbatim. The outcome matters as much as the name:
   * a sandbox write must read as `simulated`, and a `failed` in its place means
   * the tool actually tried to run and could not, which is a different and much
   * worse thing for a preview to have done.
   */
  tools: Array<{ name: string; outcome: 'read' | 'simulated' | 'proposed' | 'executed' | 'failed' }>
  /** Anything that reported itself as executed. Always empty, and asserted to be. */
  executedTools: string[]
  handoff: boolean
  suppressedReason: string | null
}

/**
 * One customer-support turn against an exact candidate, with no parent.
 *
 * `conversationId: null` is the existing admin sandbox seam: no conversation
 * means no inbox row, no involvement, no transcript message and no realtime
 * event, and `simulate` forces every write tool to report what it would do
 * before any dial is consulted. Both are asserted by the sandbox tests rather
 * than assumed.
 */
export async function runCandidateSandboxTurn(input: {
  messages: AssistantThreadMessage[]
  candidate: CandidateBehaviour
}): Promise<SandboxTurnResult> {
  const { id: assistantPrincipalId } = await ensureAssistantPrincipal()
  const result = await runAssistantTurn({
    role: 'customer_support',
    surface: 'widget',
    messages: input.messages,
    assistantPrincipalId,
    conversationId: null,
    involvementId: null,
    latestCustomerMessageId: null,
    simulate: true,
    runtimeConfigOverride: runtimeConfigFor(input.candidate),
  })
  if (result.status === 'suppressed') {
    return {
      status: 'suppressed',
      text: '',
      citations: [],
      tools: [],
      executedTools: [],
      handoff: false,
      suppressedReason: result.reason,
    }
  }
  const outcomes = result.trace.toolCalls
  return {
    status: result.status,
    text: ('text' in result ? result.text : '').slice(0, SANDBOX_TEXT_MAX_CHARS),
    citations: ('citations' in result ? result.citations : []).map((citation) => ({
      type: citation.type,
      id: citation.id,
      internal: citation.internal === true,
    })),
    tools: outcomes.map((outcome) => ({ name: outcome.name, outcome: outcome.outcome })),
    executedTools: outcomes
      .filter((outcome) => outcome.outcome === 'executed')
      .map((outcome) => outcome.name),
    handoff: 'escalation' in result && result.escalation !== null,
    suppressedReason: null,
  }
}
