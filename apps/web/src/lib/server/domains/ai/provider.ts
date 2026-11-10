/**
 * Which AI provider this process talks to.
 *
 * Exactly one provider is configured at a time, chosen by which key is set:
 *
 * - `openai`: OPENAI_API_KEY plus OPENAI_BASE_URL, any OpenAI-compatible
 *   endpoint (a direct provider, a gateway such as OpenRouter, a local server).
 * - `anthropic`: ANTHROPIC_API_KEY, the Claude API on platform.claude.com.
 *
 * Both keys set is a configuration error, not a preference order: AI is off
 * until one is removed, and the reason is logged at boot and shown in the
 * admin AI settings. Guessing which one the operator meant would bill the
 * wrong account or send workspace data to a provider nobody chose.
 *
 * Reads only `@/lib/server/config`, so it stays importable from modules whose
 * tests mock `./config`.
 */
import { config } from '@/lib/server/config'

export type AiProvider = 'openai' | 'anthropic'

export interface AiProviderEnv {
  openaiApiKey: string | undefined
  openaiBaseUrl: string | undefined
  anthropicApiKey: string | undefined
}

export type AiConfigIssue = 'multiple-providers' | 'openai-base-url-missing'

export interface AiProviderResolution {
  /** The active provider, or null when AI is off. */
  provider: AiProvider | null
  /** Why AI is off although something was configured; null when it is on or simply unset. */
  issue: AiConfigIssue | null
}

export const AI_CONFIG_ISSUE_MESSAGES: Record<AiConfigIssue, string> = {
  'multiple-providers':
    'AI disabled: both OPENAI_API_KEY and ANTHROPIC_API_KEY are set. Configure exactly one AI provider and remove the other key.',
  'openai-base-url-missing':
    'AI disabled: OPENAI_API_KEY is set but OPENAI_BASE_URL is empty. Set OPENAI_BASE_URL to your provider or gateway endpoint.',
}

/** Pure resolution of the active provider from the environment. */
export function resolveAiProvider(env: AiProviderEnv): AiProviderResolution {
  const openaiKey = Boolean(env.openaiApiKey)
  const anthropicKey = Boolean(env.anthropicApiKey)
  if (openaiKey && anthropicKey) return { provider: null, issue: 'multiple-providers' }
  if (anthropicKey) return { provider: 'anthropic', issue: null }
  if (openaiKey) {
    return env.openaiBaseUrl
      ? { provider: 'openai', issue: null }
      : { provider: null, issue: 'openai-base-url-missing' }
  }
  return { provider: null, issue: null }
}

function currentEnv(): AiProviderEnv {
  return {
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    anthropicApiKey: config.anthropicApiKey,
  }
}

/** The active provider for this process, or null when AI is off. */
export function getAiProvider(): AiProvider | null {
  return resolveAiProvider(currentEnv()).provider
}

/** Why configured AI is off, as a code; null when it is on or nothing was set. */
export function getAiConfigIssue(): AiConfigIssue | null {
  return resolveAiProvider(currentEnv()).issue
}

/**
 * The model every chat feature uses on a provider when AI_CHAT_MODEL and the
 * feature's own variable are unset. Only the Claude API has one: an
 * OpenAI-compatible endpoint is an opaque gateway whose model names Quackback
 * cannot know, so there AI stays off until a model is named (#180).
 *
 * Claude Haiku 5.5 is the one default on the Claude API: it reads images, holds
 * strict JSON schemas, and is the model the design work is tuned on. Every
 * feature uses it unless its own AI_*_MODEL variable says otherwise.
 */
export const ANTHROPIC_DEFAULT_CHAT_MODEL = 'claude-haiku-5-5'

/**
 * The API version sent as `anthropic-version`. 2026-10-21 removes the sampling
 * parameters, which Quackback never sends. ANTHROPIC_VERSION overrides it.
 */
export const ANTHROPIC_DEFAULT_API_VERSION = '2026-10-21'

export function defaultChatModelFor(provider: AiProvider | null): string | undefined {
  return provider === 'anthropic' ? ANTHROPIC_DEFAULT_CHAT_MODEL : undefined
}

/** Whether the provider has an embeddings endpoint. The Claude API does not. */
export function providerSupportsEmbeddings(provider: AiProvider | null): boolean {
  return provider === 'openai'
}
