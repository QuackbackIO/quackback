/**
 * Structured (schema-validated) chat requests.
 *
 * The request goes out as `response_format: json_schema`. Some
 * OpenAI-compatible servers reached through a custom `OPENAI_BASE_URL` reject
 * that with a 400. On such a rejection the request is retried once as
 * `response_format: json_object` with the schema described in the system
 * prompt, and the base URL is remembered for the life of the process so later
 * calls go straight to the fallback. The result is validated with the caller's
 * zod schema on either path.
 *
 * Failures that are not a response_format rejection (network, 5xx, a model
 * answering off-schema) propagate untouched, so callers keep their existing
 * handling. The fallback's own parse and validation failures carry the same
 * `code`s `chat({ outputSchema })` uses, so `isStructuredOutputError` checks
 * in callers cover both paths.
 */
import { chat, type ChatMiddleware } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { stripCodeFences, structuredOutputProviderOptions } from './config'

const log = logger.child({ component: 'ai-structured-chat' })

/** Base URLs whose server rejected `json_schema` during this process. */
const needsJsonObjectFallback = new Set<string>()

/** Test seam: forget which base URLs need the fallback. */
export function resetStructuredFallbackMemory(): void {
  needsJsonObjectFallback.clear()
}

interface ErrorShape {
  status?: number
  statusCode?: number
  param?: string
  message?: string
  error?: { param?: string; message?: string }
}

const RESPONSE_FORMAT_MENTION = /response_format|json_schema|json schema/i

/**
 * True when a provider refused the request because of its `response_format`
 * (the `json_schema` type in particular): a 400/422 whose `param` is
 * `response_format`, or whose message names `response_format` / `json_schema`.
 */
export function isResponseFormatRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as ErrorShape
  const status = e.status ?? e.statusCode
  if (status !== undefined && status !== 400 && status !== 422) return false
  if ((e.param ?? e.error?.param) === 'response_format') return true
  return RESPONSE_FORMAT_MENTION.test(`${e.message ?? ''} ${e.error?.message ?? ''}`)
}

function structuredError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

export interface StructuredChatInput<S extends z.ZodType> {
  model: string
  systemPrompts: string[]
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  schema: S
  maxTokens: number
  middleware?: ChatMiddleware[]
}

export async function structuredChat<S extends z.ZodType>(
  input: StructuredChatInput<S>
): Promise<z.infer<S>> {
  const baseURL = config.openaiBaseUrl!
  const adapter = openaiCompatibleText(input.model, { baseURL, apiKey: config.openaiApiKey! })
  const common = {
    adapter,
    messages: input.messages,
    stream: false as const,
    ...(input.middleware ? { middleware: input.middleware } : {}),
  }

  if (!needsJsonObjectFallback.has(baseURL)) {
    try {
      return (await chat({
        ...common,
        systemPrompts: input.systemPrompts,
        outputSchema: input.schema,
        modelOptions: { max_tokens: input.maxTokens, ...structuredOutputProviderOptions() },
      } as never)) as z.infer<S>
    } catch (err) {
      if (!isResponseFormatRejection(err)) throw err
      needsJsonObjectFallback.add(baseURL)
      log.warn(
        { base_url: baseURL, model: input.model, err },
        'provider rejected response_format json_schema; using json_object with the schema in the prompt'
      )
    }
  }

  const text = (await chat({
    ...common,
    systemPrompts: [...input.systemPrompts, describeSchema(input.schema)],
    modelOptions: {
      max_tokens: input.maxTokens,
      response_format: { type: 'json_object' },
      ...structuredOutputProviderOptions(),
    },
  } as never)) as unknown as string

  const raw = typeof text === 'string' ? stripCodeFences(text.trim()).trim() : ''
  if (!raw) {
    throw structuredError('structured-output-missing-result', 'structured output was empty')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw structuredError(
      'structured-output-parse-failed',
      `structured output was not valid JSON: ${raw.slice(0, 200)}`
    )
  }
  const result = input.schema.safeParse(parsed)
  if (!result.success) {
    throw structuredError(
      'structured-output-validation-failed',
      `structured output did not match the schema: ${result.error.message.slice(0, 300)}`
    )
  }
  return result.data
}

function describeSchema(schema: z.ZodType): string {
  return (
    'Respond with a single JSON object and nothing else (no prose, no code fences). ' +
    `It must conform to this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`
  )
}
