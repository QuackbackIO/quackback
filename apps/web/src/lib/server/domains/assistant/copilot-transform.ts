/**
 * Copilot transforms (P2-C.1, COPILOT-SIDEBAR-UX.md "What P2-C adds"):
 * tone/format rewrites over already-composed text. Two entry points drive it:
 * the answer card's "Add to composer & modify" menu (source = the streamed
 * answer text) and the composer's Improve menu (source = the teammate's
 * own draft). Both funnel through this one module.
 *
 * Calls the shared synthesis core (synthesis-core.ts) DIRECTLY with
 * `tools: null`, the same shape `synthesis.ts` uses for Ask AI's one-shot
 * answer: this is the third direct caller alongside it and the tool-using
 * turn (assistant.runtime.ts). No citations, no retrieval: the input text is
 * the entire context, so the output schema is just `{ text: string }`.
 *
 * `my_tone` is the one transform that needs extra context. It derives aggregate
 * style statistics from the teammate's recent outbound replies without sending
 * any prior customer's text to the model. A teammate with no prior
 * replies degrades to a neutral "match a professional, warm support voice"
 * instruction rather than failing or stalling.
 */
import { z } from 'zod'
import type { StreamChunk } from '@tanstack/ai'
import { db, conversationMessages, eq, and, desc, isNull } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { getChatModel } from '@/lib/server/domains/ai/models'
import type { TransformKind } from '@/lib/shared/assistant/copilot-contract'
import { runSynthesis, salvageJsonWithSchema } from './synthesis-core'
import { wrapUntrustedText } from './injection-guard'

/** How far back we look for the teammate's own outbound replies. */
const STYLE_LOOKBACK_MESSAGES = 10
const TRANSFORM_TASK: Record<TransformKind, string> = {
  my_tone:
    "Rewrite the text to sound like the teammate's own voice, following the derived style profile below.",
  more_friendly: 'Rewrite the text in a warmer, more friendly tone.',
  more_formal: 'Rewrite the text in a more formal, professional tone.',
  more_concise: 'Rewrite the text to be noticeably tighter and shorter without losing any facts.',
  expand:
    'Expand the text with helpful, relevant detail that stays consistent with what is already there.',
  rephrase: 'Rephrase the text in different words while keeping the same meaning.',
  fix_grammar:
    'Fix grammar, spelling, and punctuation only. Do not change the meaning, tone, or wording beyond what correctness requires.',
}

const transformOutputSchema = z.object({ text: z.string() })

/**
 * Aggregate the teammate's last customer-facing replies into non-content style
 * signals. Raw reply text never leaves this function.
 */
export interface TeammateStyleProfile {
  replyCount: number
  averageWords: number
  averageSentenceWords: number
  exclamationRate: number
  questionRate: number
  multilineRate: number
}

export async function fetchTeammateStyleProfile(
  principalId: PrincipalId
): Promise<TeammateStyleProfile | null> {
  const rows = await db
    .select({ content: conversationMessages.content })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.principalId, principalId),
        eq(conversationMessages.senderType, 'agent'),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt)
      )
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(STYLE_LOOKBACK_MESSAGES)

  const replies = rows.flatMap((row) => {
    const content = row.content?.trim()
    return content ? [content] : []
  })
  if (replies.length === 0) return null

  const wordCounts = replies.map((reply) => reply.split(/\s+/u).length)
  const sentenceCount = replies.reduce(
    (total, reply) => total + Math.max(1, reply.split(/[.!?]+/u).filter(Boolean).length),
    0
  )
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    replyCount: replies.length,
    averageWords: round(wordCounts.reduce((total, count) => total + count, 0) / replies.length),
    averageSentenceWords: round(
      wordCounts.reduce((total, count) => total + count, 0) / sentenceCount
    ),
    exclamationRate: round(replies.filter((reply) => reply.includes('!')).length / replies.length),
    questionRate: round(replies.filter((reply) => reply.includes('?')).length / replies.length),
    multilineRate: round(replies.filter((reply) => reply.includes('\n')).length / replies.length),
  }
}

/** The `my_tone` aggregate style block. It contains no prior reply content. */
function buildStyleReferenceBlock(profile: TeammateStyleProfile | null): string {
  if (!profile) {
    return 'No prior replies are on file for this teammate: match a professional, warm support voice instead.'
  }
  return [
    `Derived style profile from ${profile.replyCount} prior replies; no prior reply content is included.`,
    `Average reply length: ${profile.averageWords} words.`,
    `Average sentence length: ${profile.averageSentenceWords} words.`,
    `Exclamation frequency: ${profile.exclamationRate}. Question frequency: ${profile.questionRate}. Multiline frequency: ${profile.multilineRate}.`,
  ].join('\n')
}

/**
 * System prompts for one transform attempt: task instructions + guardrails,
 * the `my_tone` style reference block (only for that transform), then the
 * input text itself, wrapped by the shared `wrapUntrustedText` helper
 * (injection-guard.ts) as content to transform rather than instructions to
 * follow, in the same guard family as `buildAskAiSystemPrompts`'s injection
 * guard. Exported so tests can pin the guard, the grounding rule,
 * and that one transform never leaks another transform's instructions.
 */
export function buildTransformSystemPrompts(
  transform: TransformKind,
  text: string,
  styleProfile: TeammateStyleProfile | null = null
): string[] {
  const instructions = [
    'You are helping a support teammate edit a piece of text for a customer conversation.',
    `Task: ${TRANSFORM_TASK[transform]}`,
    'Rules:',
    '- Preserve the meaning and every fact already in the text. NEVER add facts, claims, numbers, or details that are not already present in it.',
    '- Keep any inline formatting already present (citation markers like [1], bullet or numbered lists, **bold**) unless the task above specifically requires removing it.',
    '- Reply with the rewritten text only: no preamble, no commentary, no surrounding quotation marks.',
    'Respond with ONLY a single JSON object of this exact shape: {"text": string}. Put the rewritten text inside "text".',
    'Example output:',
    '{"text": "Thanks for flagging this! I\'ve refunded the duplicate charge, and you\'ll see it back on your card within 3-5 business days."}',
  ].join('\n')

  const blocks = [instructions]
  if (transform === 'my_tone') {
    blocks.push(buildStyleReferenceBlock(styleProfile))
  }
  blocks.push(wrapUntrustedText('Text to transform', text))
  return blocks
}

export interface RunCopilotTransformParams {
  transform: TransformKind
  /** The text to transform (the streamed answer, or the teammate's draft). */
  text: string
  /** The acting teammate: `my_tone` mines this principal's own past replies. */
  principalId: PrincipalId
  signal?: AbortSignal
  onTextDelta?: (delta: string) => void
  /**
   * AG-UI wire forwarding (see synthesis-core's option of the same name):
   * receives the attempt's committed model-stream chunks for a route serving
   * the AG-UI protocol. The route owns the canonical run lifecycle around them
   * (streamSynthesisToWire); direct callers leave it unset and are unchanged.
   */
  wireSink?: (chunk: StreamChunk) => void
}

export interface CopilotTransformResult {
  text: string
}

/**
 * Run one transform attempt through the synthesis core. `onFailure: 'throw'`:
 * unlike the customer-facing assistant turn, a transform failure should
 * surface to the teammate (nothing was silently swallowed on their behalf),
 * mirroring Ask AI's `synthesizeAnswer` rather than `runAssistantTurn`'s
 * always-answer fallback.
 */
export async function runCopilotTransform(
  params: RunCopilotTransformParams
): Promise<CopilotTransformResult> {
  // The route gates on isAssistantConfigured() before this is ever called,
  // which guarantees getChatModel('assistant') is non-null.
  const model = getChatModel('assistant')!

  const styleProfile =
    params.transform === 'my_tone' ? await fetchTeammateStyleProfile(params.principalId) : null
  const systemPrompts = buildTransformSystemPrompts(params.transform, params.text, styleProfile)

  const outcome = await runSynthesis<never>({
    model,
    systemPrompts,
    messages: [
      {
        role: 'user',
        content: 'Return the rewritten text now, following the instructions and rules above.',
      },
    ],
    outputSchema: transformOutputSchema,
    tools: null,
    // A teammate can just re-run a transform; no transport re-dial (default 0).
    transportRetries: 0,
    deltaField: 'text',
    salvageMode: 'strict',
    salvage: (raw) => salvageJsonWithSchema(transformOutputSchema, raw),
    onFailure: 'throw',
    signal: params.signal,
    onTextDelta: params.onTextDelta,
    wireSink: params.wireSink,
    usageLogParams: {
      pipelineStep: 'copilot_transform',
      callType: 'chat_completion',
      model,
      metadata: { transform: params.transform },
    },
    deriveAnswerKind: (attempt) => (attempt.final !== null ? 'answered' : 'invalid_output'),
  })

  if (outcome.outcome === 'fallback') {
    // Unreachable: onFailure:'throw' always throws on total failure rather
    // than resolving to a fallback value.
    throw outcome.lastError ?? new Error('transform failed')
  }
  return transformOutputSchema.parse(outcome.final)
}
