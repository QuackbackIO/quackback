/**
 * The TanStack AI text adapter for the active provider (see ./provider).
 *
 * Every `chat()` caller builds its adapter here, so the provider is chosen in
 * one place. Callers keep writing OpenAI-shaped `modelOptions`
 * (`max_tokens`, OpenRouter's `provider` / `reasoning` extras); on the Claude
 * API those are translated, not forwarded:
 *
 * - `max_tokens` is kept, plus headroom when the model may think, since
 *   thinking tokens count against it.
 * - Thinking: with AI_REASONING_EFFORT unset it is turned off on models that
 *   allow that (Claude Haiku 5.5 among them), matching the non-reasoning
 *   behaviour the prompts were tuned on. With it set, thinking stays adaptive
 *   at that effort (`output_config.effort`). Models that cannot turn it off
 *   (Claude Opus 5.5, Sonnet 5.5, Fable) run at `low` effort by default.
 * - OpenRouter extras are dropped.
 * - Structured output always goes in the one streaming request as
 *   `output_config.format` (never the forced-tool fallback), with the JSON
 *   Schema cut to what the API accepts; the caller's zod schema still
 *   validates the answer in full.
 * - Sampling parameters are never sent (API version 2026-10-21 rejects them).
 * - Input tokens are read from `message_start` when `message_delta` leaves
 *   them out, so usage logging counts the prompt (the package reads only the
 *   delta).
 */
import Anthropic from '@anthropic-ai/sdk'
import type { AdapterYieldChunk } from '@tanstack/ai'
import {
  AnthropicTextAdapter,
  type ANTHROPIC_MODELS,
  type AnthropicMessagesClient,
} from '@tanstack/ai-anthropic'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { config } from '@/lib/server/config'
import { ANTHROPIC_DEFAULT_API_VERSION, getAiProvider } from './provider'

type AnthropicModel = (typeof ANTHROPIC_MODELS)[number]
type OpenAiCompatibleAdapter = ReturnType<typeof openaiCompatibleText>
type AnthropicModelOptions = Record<string, unknown>
type AnthropicChatStreamOptions = Parameters<AnthropicTextAdapter<AnthropicModel>['chatStream']>[0]

/** Extra output room for thinking when it may run; a ceiling, billed only when used. */
export const ANTHROPIC_THINKING_HEADROOM_TOKENS = 8_000

const ANTHROPIC_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** Models where `thinking: {type: 'disabled'}` is a 400; effort is the only dial. */
const THINKING_ALWAYS_ON = /claude-(opus-5-5|sonnet-5-5|fable|mythos)/

/** AI_REASONING_EFFORT as a Claude effort level, or null when unset or unknown. */
export function anthropicEffort(raw: string | undefined): string | null {
  const effort = raw?.trim().toLowerCase()
  if (!effort) return null
  if (effort === 'minimal') return 'low'
  return ANTHROPIC_EFFORTS.has(effort) ? effort : null
}

/**
 * Rebuild a caller's OpenAI-shaped modelOptions for the Claude API: keep the
 * output cap, set thinking and effort, drop everything else.
 */
export function anthropicModelOptions(
  model: string,
  callerOptions: Record<string, unknown> | undefined,
  reasoningEffort: string | undefined
): AnthropicModelOptions {
  const requested =
    typeof callerOptions?.max_tokens === 'number' ? callerOptions.max_tokens : undefined
  const effort = anthropicEffort(reasoningEffort)
  const alwaysThinks = THINKING_ALWAYS_ON.test(model)
  if (!effort && !alwaysThinks) {
    return {
      ...(requested !== undefined ? { max_tokens: requested } : {}),
      thinking: { type: 'disabled' },
    }
  }
  return {
    ...(requested !== undefined
      ? { max_tokens: requested + ANTHROPIC_THINKING_HEADROOM_TOKENS }
      : {}),
    output_config: { effort: effort ?? 'low' },
  }
}

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
])

const SUPPORTED_STRING_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
])

/**
 * A JSON Schema the Claude API's structured outputs accept: numeric, length,
 * pattern and most array constraints removed, `minItems` kept only at 0 or 1,
 * unknown string formats removed, and every object closed with
 * `additionalProperties: false`. Constraints removed here are still enforced
 * when the caller's zod schema validates the answer.
 */
export function toAnthropicOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toAnthropicOutputSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue
    if (key === 'minItems' && (typeof value !== 'number' || value > 1)) continue
    if (key === 'format' && (typeof value !== 'string' || !SUPPORTED_STRING_FORMATS.has(value)))
      continue
    if (key === 'additionalProperties') continue
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, sub]) => [
          name,
          toAnthropicOutputSchema(sub),
        ])
      )
      continue
    }
    out[key] = toAnthropicOutputSchema(value)
  }
  if (out.type === 'object' || 'properties' in out) out.additionalProperties = false
  return out
}

type StreamEvent = {
  type: string
  message?: { usage?: Record<string, unknown> }
  usage?: Record<string, unknown>
}

/**
 * Carry the prompt-side usage from `message_start` onto `message_delta`, whose
 * usage block may hold only `output_tokens`.
 */
export async function* withPromptUsage<E extends StreamEvent>(
  events: AsyncIterable<E>
): AsyncIterable<E> {
  let prompt: Record<string, unknown> = {}
  for await (const event of events) {
    if (event.type === 'message_start' && event.message?.usage) {
      const { output_tokens: _output, ...rest } = event.message.usage
      prompt = rest
    }
    if (event.type === 'message_delta' && event.usage) {
      const merged = { ...event.usage }
      for (const [key, value] of Object.entries(prompt)) {
        if (merged[key] === undefined || merged[key] === null) merged[key] = value
      }
      yield { ...event, usage: merged }
      continue
    }
    yield event
  }
}

/** The SDK client the adapter calls, with prompt usage carried onto the delta. */
function anthropicMessagesClient(options: ConstructorParameters<typeof Anthropic>[0]) {
  const sdk = new Anthropic(options)
  const create = async (params: { stream?: boolean }, requestOptions?: unknown) => {
    const response = await sdk.beta.messages.create(params as never, requestOptions as never)
    return params.stream
      ? withPromptUsage(response as unknown as AsyncIterable<StreamEvent>)
      : response
  }
  return { beta: { messages: { create } } } as unknown as AnthropicMessagesClient
}

/**
 * The Claude adapter with Quackback's request mapping. Haiku 5.5 and every
 * other current Claude model takes tools and `output_config.format` in one
 * request, so the engine never takes the package's forced-tool path, which
 * newer models reject.
 */
export class QuackbackAnthropicAdapter extends AnthropicTextAdapter<AnthropicModel> {
  override supportsCombinedToolsAndSchema(): boolean {
    return true
  }

  override async *chatStream(
    options: AnthropicChatStreamOptions
  ): AsyncIterable<AdapterYieldChunk> {
    const { tools, ...rest } = options
    yield* super.chatStream({
      ...rest,
      // An empty tool list is sent as `tools: []`; leave it off instead.
      ...(tools && tools.length > 0 ? { tools } : {}),
      modelOptions: anthropicModelOptions(
        options.model,
        options.modelOptions as Record<string, unknown> | undefined,
        config.aiReasoningEffort
      ),
      ...(options.outputSchema
        ? {
            outputSchema: toAnthropicOutputSchema(
              options.outputSchema
            ) as typeof options.outputSchema,
          }
        : {}),
    } as AnthropicChatStreamOptions)
  }
}

/** Client options for the Claude API; `fetch` is a test seam. */
export function anthropicClientOptions(overrides: { fetch?: typeof fetch } = {}) {
  return {
    apiKey: config.anthropicApiKey!,
    defaultHeaders: {
      'anthropic-version': config.anthropicVersion ?? ANTHROPIC_DEFAULT_API_VERSION,
    },
    ...overrides,
  }
}

/**
 * The text adapter for `model` on the active provider. Typed as the
 * OpenAI-compatible adapter so callers' `chat()` options keep one shape; the
 * Claude adapter translates them (see the module comment). Call only when
 * `isAiClientConfigured()` holds.
 */
export function createChatAdapter(
  model: string,
  overrides: { fetch?: typeof fetch } = {}
): OpenAiCompatibleAdapter {
  if (getAiProvider() === 'anthropic') {
    return new QuackbackAnthropicAdapter(
      { client: anthropicMessagesClient(anthropicClientOptions(overrides)) },
      model as AnthropicModel
    ) as unknown as OpenAiCompatibleAdapter
  }
  return openaiCompatibleText(model, {
    baseURL: config.openaiBaseUrl!,
    apiKey: config.openaiApiKey!,
  })
}
