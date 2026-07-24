/**
 * Scenario runner. Invokes `runAssistantTurn` directly (never over HTTP) with
 * the test route's isolation semantics, captures the streamed activity + tool
 * ledger, grades structurally, and runs the judge where a rubric is declared.
 *
 * Toolset scenarios assert on the assembled tool set with no model call.
 * Contrast scenarios run the same prompt under two configs and judge the pair.
 */
import type { PrincipalId } from '@quackback/ids'
import { testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  runAssistantTurn,
  type AssistantActivity,
  type AssistantTurnInput,
  type AssistantTurnResult,
} from '@/lib/server/domains/assistant/assistant.runtime'
import { makeAssistantToolContext } from '@/lib/server/domains/assistant/assistant.toolspec'
import { assembleAssistantToolset } from '@/lib/server/domains/assistant/assistant.tools'
import { resolveAssistantRolePolicy } from '@/lib/server/domains/assistant/assistant.system-prompt'
import { resolveContentAudience } from '@/lib/server/domains/assistant/audience'
import { resolveAssistantKnowledgeSnapshot } from '@/lib/server/domains/assistant/retrieval-sources'
import { roleToAgent } from '@/lib/shared/assistant/config'
import { seedFixtures, buildScenarioAssistantConfig, type SeededConversation } from './seed'
import { gradeStructural, type TurnCapture } from './grade'
import { judgeSingle, judgeContrast } from './judge'
import {
  surfaceForRole,
  type AssistantRole,
  type ContrastScenario,
  type Scenario,
  type ThreadMessage,
  type ToolsetScenario,
  type TurnScenario,
} from '../types'

export interface RunOutcome {
  failures: string[]
  detail: Record<string, unknown>
  /** A harness/runtime error (config, DB, provider) — distinct from a genuine scenario failure. */
  errored: boolean
}

function threadFor(scenario: TurnScenario): ThreadMessage[] {
  if (scenario.thread) return scenario.thread
  if (scenario.prompt) return [{ sender: 'customer', content: scenario.prompt }]
  return []
}

/** Excerpt cap for a seeded source handed to the groundedness judge. */
const JUDGE_SOURCE_EXCERPT_CHARS = 600

/**
 * The knowledge the reply was allowed to ground on, for a groundedness judge:
 * each seeded KB article as title + a trimmed excerpt. Empty for scenarios that
 * seed no articles (the judge then grades on prompt + reply alone, as before).
 */
function sourcesForJudge(scenario: TurnScenario): { title: string; excerpt: string }[] {
  return (scenario.fixtures?.kbArticles ?? []).map((a) => ({
    title: a.title,
    excerpt: a.content.slice(0, JUDGE_SOURCE_EXCERPT_CHARS),
  }))
}

function buildTurnInput(
  scenario: TurnScenario,
  role: AssistantRole,
  assistantPrincipalId: PrincipalId,
  conversation: SeededConversation | undefined
): AssistantTurnInput {
  const surface = surfaceForRole(scenario, role)
  const messages = threadFor(scenario)
  const common = {
    assistantPrincipalId,
    db: testDb,
    conversationId: conversation?.conversationId ?? null,
    involvementId: conversation?.involvementId ?? null,
    latestCustomerMessageId: conversation?.latestCustomerMessageId ?? null,
  }
  if (role === 'copilot_qa') {
    return { ...common, role, surface: 'copilot', messages }
  }
  return { ...common, role: 'customer_support', surface: surface as never, messages }
}

function captureFrom(
  result: AssistantTurnResult,
  activities: AssistantActivity[],
  deltas: string[]
): { capture: TurnCapture; detail: Record<string, unknown> } {
  const toolOutcomes = result.status === 'suppressed' ? [] : result.trace.toolCalls
  const citations = 'citations' in result ? result.citations : []
  const proposedActions = 'proposedActions' in result ? result.proposedActions : []
  const text = 'text' in result ? result.text : ''
  const internalSourced = 'internalSourced' in result ? result.internalSourced : false
  const handoffReason =
    'escalation' in result && result.escalation ? result.escalation.reason : null
  const inabilityReason = result.status === 'cannot_answer' ? result.cannotAnswerReason : null
  const capture: TurnCapture = {
    kind: 'turn',
    result,
    toolOutcomes,
    citations,
    proposedActions,
    text,
    internalSourced,
    handoffReason,
    inabilityReason,
  }
  const detail = {
    status: result.status,
    text,
    citations: citations.map((c) => ({ type: c.type, id: c.id, internal: c.internal })),
    toolLedger: toolOutcomes,
    proposedActions,
    internalSourced,
    handoffReason,
    inabilityReason,
    activity: activities,
    streamedChunks: deltas.length,
  }
  return { capture, detail }
}

/** One turn attempt: seed, run, capture, grade, judge. */
async function runTurnOnce(scenario: TurnScenario, role: AssistantRole): Promise<RunOutcome> {
  let seeded
  try {
    seeded = await seedFixtures(scenario.config, scenario.fixtures)
  } catch (err) {
    return { failures: [String(err)], detail: { seedError: String(err) }, errored: true }
  }

  const input = buildTurnInput(scenario, role, seeded.assistantPrincipalId, seeded.conversation)
  const activities: AssistantActivity[] = []
  const deltas: string[] = []

  let result: AssistantTurnResult
  try {
    result = await runAssistantTurn({
      ...input,
      onActivity: (a) => activities.push(a),
      onTextDelta: (d) => deltas.push(d),
    })
  } catch (err) {
    return {
      failures: [`runtime threw: ${err instanceof Error ? err.message : String(err)}`],
      detail: { runtimeError: String(err), activity: activities },
      errored: true,
    }
  }

  const { capture, detail } = captureFrom(result, activities, deltas)
  const failures = gradeStructural(scenario.structural, capture)

  if (scenario.rubric) {
    try {
      const verdict = await judgeSingle(scenario.rubric, {
        prompt: threadFor(scenario)
          .map((m) => `${m.sender}: ${m.content}`)
          .join('\n'),
        reply: capture.text,
        citations: capture.citations.map((c) => `${c.type}:${c.id}`),
        // A groundedness judge can only check the reply against the knowledge it
        // was allowed to cite; hand it the seeded source snippets (title +
        // excerpt) so it verifies support rather than penalizing facts it cannot
        // see. Non-grounding rubrics simply ignore these.
        sources: sourcesForJudge(scenario),
      })
      detail.judge = verdict
      if (!verdict.pass) failures.push(`judge(${scenario.rubric.dimension}): ${verdict.reasoning}`)
    } catch (err) {
      return {
        failures: [`judge error: ${err instanceof Error ? err.message : String(err)}`],
        detail: { ...detail, judgeError: String(err) },
        errored: true,
      }
    }
  }

  return { failures, detail, errored: false }
}

/** Turn scenario with repeats + stability threshold (§7.3 #8). */
export async function runTurnScenario(
  scenario: TurnScenario,
  role: AssistantRole
): Promise<RunOutcome> {
  const repeats = scenario.repeats ?? 1
  if (repeats === 1) return runTurnOnce(scenario, role)

  const threshold = scenario.stabilityThreshold ?? 1
  const runs: RunOutcome[] = []
  for (let i = 0; i < repeats; i++) runs.push(await runTurnOnce(scenario, role))

  const errored = runs.some((r) => r.errored)
  const passes = runs.filter((r) => r.failures.length === 0).length
  const rate = passes / repeats
  const detail = {
    repeats,
    passes,
    rate,
    threshold,
    runs: runs.map((r, i) => ({ run: i + 1, failures: r.failures, detail: r.detail })),
  }
  if (errored) {
    return { failures: [`harness error across repeats`], detail, errored: true }
  }
  if (rate + 1e-9 >= threshold) return { failures: [], detail, errored: false }
  return {
    failures: [`stability ${passes}/${repeats} (${rate.toFixed(2)}) < threshold ${threshold}`],
    detail,
    errored: false,
  }
}

/** Toolset scenario: assert on the assembled tool set, no model call. */
export async function runToolsetScenario(
  scenario: ToolsetScenario,
  role: AssistantRole
): Promise<RunOutcome> {
  let seeded
  try {
    seeded = await seedFixtures(scenario.config, scenario.fixtures)
  } catch (err) {
    return { failures: [String(err)], detail: { seedError: String(err) }, errored: true }
  }

  const surface = surfaceForRole(scenario, role)
  const audience = resolveContentAudience(surface)
  const rolePolicy = resolveAssistantRolePolicy(role)
  const conversationId = seeded.conversation?.conversationId ?? null

  const ctx = makeAssistantToolContext({
    db: testDb,
    assistantPrincipalId: seeded.assistantPrincipalId,
    role,
    audience,
    conversationId,
    // Mirror the runtime: compile the resolved agent's knowledge map into the
    // turn's enabled retrieval sources + status flag.
    knowledge: resolveAssistantKnowledgeSnapshot(
      roleToAgent(role),
      buildScenarioAssistantConfig(scenario.config ?? {}),
      audience
    ),
    // Mirror the runtime's own selection: simulate forces 'simulate', else the
    // role policy's write policy governs which write tools survive assembly.
    simulate: conversationId === null,
    writeToolPolicy: conversationId === null ? 'simulate' : rolePolicy.writeToolPolicy,
  })
  const { tools } = await assembleAssistantToolset(
    ctx,
    undefined,
    scenario.config?.assistantTools === true
  )
  const toolNames = tools.map((t) => t.name)
  const failures = gradeStructural(scenario.structural, { kind: 'toolset', toolNames })
  return {
    failures,
    detail: { toolNames, role, actionsEnabled: scenario.config?.assistantTools === true },
    errored: false,
  }
}

/** Contrast scenario: same prompt, two configs, judge the difference. */
export async function runContrastScenario(
  scenario: ContrastScenario,
  role: AssistantRole
): Promise<RunOutcome> {
  const replies: { label: string; reply: string }[] = []
  const detailVariants: Record<string, unknown>[] = []
  for (const variant of scenario.variants) {
    const turn: TurnScenario = {
      ...scenario,
      kind: 'turn',
      config: { ...scenario.config, ...variant.config },
      prompt: scenario.prompt,
      structural: [{ type: 'status', oneOf: ['answered', 'cannot_answer'] }],
      rubric: undefined,
    }
    const out = await runTurnOnce(turn, role)
    if (out.errored) return { failures: out.failures, detail: out.detail, errored: true }
    const reply = String((out.detail as { text?: string }).text ?? '')
    replies.push({ label: variant.label, reply })
    detailVariants.push({ label: variant.label, reply, structural: out.failures })
  }

  try {
    const verdict = await judgeContrast(scenario.rubric, {
      prompt: scenario.prompt,
      variants: replies,
    })
    const failures = verdict.pass
      ? []
      : [`judge(${scenario.rubric.dimension}): ${verdict.reasoning}`]
    return { failures, detail: { variants: detailVariants, judge: verdict }, errored: false }
  } catch (err) {
    return {
      failures: [`judge error: ${err instanceof Error ? err.message : String(err)}`],
      detail: { variants: detailVariants, judgeError: String(err) },
      errored: true,
    }
  }
}

export async function runScenario(scenario: Scenario, role: AssistantRole): Promise<RunOutcome> {
  if (scenario.kind === 'toolset') return runToolsetScenario(scenario, role)
  if (scenario.kind === 'contrast') return runContrastScenario(scenario, role)
  return runTurnScenario(scenario, role)
}
