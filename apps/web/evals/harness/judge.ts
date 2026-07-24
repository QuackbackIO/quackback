/**
 * LLM judge (§7.4 tier 2). Used ONLY where quality is the question: tone/length
 * contrast, groundedness, writing-guideline adherence. Judged by the configured
 * quality-gate model (falling back to the assistant model). Rubrics are
 * versioned files under evals/rubrics/ — a judge/rubric change is itself an
 * eval-gated change (§7.4). Calibrate against human labels before trusting the
 * judge as a gate.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getOpenAI, stripCodeFences } from '@/lib/server/domains/ai/config'
import { extractFirstJsonObject } from '@/lib/server/domains/assistant/assistant.runtime'
import { judgeModel } from './env'
import type { RubricRef } from '../types'

const rubricsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../rubrics')

export interface JudgeVerdict {
  pass: boolean
  score: number
  reasoning: string
}

function loadRubric(ref: RubricRef): string {
  const full = path.resolve(rubricsDir, ref.file)
  if (!full.startsWith(rubricsDir))
    throw new Error(`[evals] rubric path escapes rubrics/: ${ref.file}`)
  return readFileSync(full, 'utf8')
}

function parseVerdict(raw: string): JudgeVerdict {
  const candidate = extractFirstJsonObject(raw) ?? stripCodeFences(raw).trim()
  const parsed = JSON.parse(candidate) as Partial<JudgeVerdict>
  return {
    pass: parsed.pass === true,
    score: typeof parsed.score === 'number' ? parsed.score : parsed.pass === true ? 5 : 1,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '(no reasoning)',
  }
}

async function callJudge(system: string, user: string): Promise<JudgeVerdict> {
  const openai = getOpenAI()
  if (!openai) throw new Error('[evals] AI client not configured for the judge')
  const completion = await openai.chat.completions.create({
    model: judgeModel(),
    temperature: 0,
    // json_object (not json_schema): universally supported, and the prompt
    // already says "JSON" as the mode requires. Salvage in parseVerdict stays
    // as the fallback for providers that ignore the parameter.
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  const raw = completion.choices[0]?.message?.content ?? ''
  try {
    return parseVerdict(raw)
  } catch {
    // A judge that won't emit clean JSON is a judge failure, not a scenario
    // failure — surface it loudly rather than silently passing/failing.
    throw new Error(`[evals] judge did not return parseable JSON. Raw: ${raw.slice(0, 400)}`)
  }
}

const JUDGE_SYSTEM =
  'You are a strict evaluation judge for a customer-support AI assistant. You grade one ' +
  'dimension against a rubric. Be conservative: only pass when the rubric is clearly met. ' +
  'Respond with ONLY a JSON object: {"pass": boolean, "score": number (1-5), "reasoning": string}. ' +
  'No prose outside the JSON. Example output: ' +
  '{"pass": false, "score": 2, "reasoning": "The reply invents a settings path not present in the sources."}'

/** Judge a single turn's output against a rubric (groundedness, writing style). */
export async function judgeSingle(
  ref: RubricRef,
  input: {
    prompt: string
    reply: string
    citations?: string[]
    /** The knowledge the reply could ground on (title + excerpt), so a
     *  groundedness judge verifies support instead of penalizing unseen facts. */
    sources?: { title: string; excerpt: string }[]
  }
): Promise<JudgeVerdict> {
  const rubric = loadRubric(ref)
  const user = [
    `RUBRIC (dimension: ${ref.dimension}):`,
    rubric,
    '',
    `CUSTOMER PROMPT:\n${input.prompt}`,
    '',
    `ASSISTANT REPLY:\n${input.reply}`,
    input.citations && input.citations.length
      ? `\nCITATIONS: ${input.citations.join(', ')}`
      : '\nCITATIONS: (none)',
    input.sources && input.sources.length
      ? `\nRETRIEVED KNOWLEDGE (the sources the reply was allowed to cite):\n` +
        input.sources.map((s) => `- ${s.title}: ${s.excerpt}`).join('\n')
      : '\nRETRIEVED KNOWLEDGE: (none seeded)',
  ].join('\n')
  return callJudge(JUDGE_SYSTEM, user)
}

/** Judge a contrast: two replies to the same prompt under different config. */
export async function judgeContrast(
  ref: RubricRef,
  input: { prompt: string; variants: { label: string; reply: string }[] }
): Promise<JudgeVerdict> {
  const rubric = loadRubric(ref)
  const user = [
    `RUBRIC (dimension: ${ref.dimension}):`,
    rubric,
    '',
    `CUSTOMER PROMPT (identical for every variant):\n${input.prompt}`,
    '',
    ...input.variants.map((v) => `VARIANT "${v.label}" REPLY:\n${v.reply}\n`),
    'Judge whether the variants differ in the rubric dimension in the expected direction.',
  ].join('\n')
  return callJudge(JUDGE_SYSTEM, user)
}
