/**
 * THE authorize-request builder. One provider row in, one request configuration
 * out, read by production sign-in and by the admin connection test alike.
 */

import { effectiveScopes } from './oidc-scopes'

/**
 * Sent when a provider has no explicit preference. `login` is the widely
 * supported choice; `select_account` is OIDC-optional and some IdPs reject it.
 */
export const DEFAULT_OIDC_PROMPT = 'login'

/** Credentials in the request body. The other common choice is HTTP Basic. */
export const DEFAULT_TOKEN_AUTH_METHOD = 'post'

/**
 * `omit` is not an OIDC value — it means "send no prompt at all", which is
 * NOT the same as `none`. Omitting leaves the provider to behave normally;
 * `none` demands it render no interface and fail when nobody is signed in.
 */
export const PROMPT_CHOICES = [
  { value: 'login', label: 'Re-authenticate' },
  { value: 'select_account', label: 'Show the account picker' },
  { value: 'consent', label: 'Ask for consent' },
  { value: 'omit', label: "Don't send a prompt" },
  { value: 'none', label: 'Silent, fail if signed out' },
] as const

export const TOKEN_AUTH_CHOICES = [
  { value: 'post', label: 'Send credentials in the request body' },
  { value: 'basic', label: 'Send credentials as HTTP Basic' },
] as const

export type PromptChoice = (typeof PROMPT_CHOICES)[number]['value']
export type TokenAuthChoice = (typeof TOKEN_AUTH_CHOICES)[number]['value']

function isPromptChoice(value: unknown): value is PromptChoice {
  return PROMPT_CHOICES.some((c) => c.value === value)
}

function isTokenAuthChoice(value: unknown): value is TokenAuthChoice {
  return TOKEN_AUTH_CHOICES.some((c) => c.value === value)
}

export interface AuthorizeRequestSource {
  scopes?: string | null
  prompt?: string | null
  tokenEndpointAuthMethod?: string | null
}

/** What actually goes on the wire — `omit` is our sentinel and is resolved to
 *  `undefined` here, so it can never escape the builder. */
export type WirePrompt = Exclude<PromptChoice, 'omit'>

export interface AuthorizeRequest {
  scopes: string[]
  /** Undefined means send no `prompt` parameter at all. */
  prompt: WirePrompt | undefined
  tokenAuth: TokenAuthChoice
}

export function authorizeRequestFor(provider: AuthorizeRequestSource): AuthorizeRequest {
  const prompt = isPromptChoice(provider.prompt) ? provider.prompt : DEFAULT_OIDC_PROMPT
  const tokenAuth = isTokenAuthChoice(provider.tokenEndpointAuthMethod)
    ? provider.tokenEndpointAuthMethod
    : DEFAULT_TOKEN_AUTH_METHOD

  return {
    scopes: effectiveScopes({ scopes: provider.scopes ?? null }),
    prompt: prompt === 'omit' ? undefined : prompt,
    tokenAuth,
  }
}

/** Null for the default or anything unrecognised, so an untouched provider is
 *  never rewritten and a free-typed value never reaches the IdP. */
export function normalizePromptInput(value: string): string | null {
  if (!isPromptChoice(value) || value === DEFAULT_OIDC_PROMPT) return null
  return value
}

export function normalizeTokenAuthInput(value: string): string | null {
  if (!isTokenAuthChoice(value) || value === DEFAULT_TOKEN_AUTH_METHOD) return null
  return value
}

/**
 * Whether the provider advertises this prompt. An absent or empty
 * `prompt_values_supported` means UNKNOWN rather than unsupported.
 */
export function supportsPrompt(
  prompt: string | undefined,
  supported: readonly string[] | null | undefined
): boolean {
  if (!prompt) return true
  if (!supported || supported.length === 0) return true
  return supported.includes(prompt)
}
