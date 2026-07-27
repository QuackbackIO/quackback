/**
 * THE authorize-request builder. One provider row in, one request configuration
 * out, read by production sign-in and by the admin connection test alike.
 *
 * It exists because three separate parameters of that request were found either
 * hardcoded or set differently by the two paths, each surfacing as a customer
 * bug: the scopes, the prompt, and the token-endpoint authentication method. A
 * connection test that assembles its own request can report success while
 * sign-in fails, which is the failure this whole area keeps producing.
 *
 * So the rule is stronger than "add a column per parameter": anything the
 * authorize or token request carries comes from HERE, and a fourth parameter
 * cannot quietly diverge without someone deliberately routing around it.
 */

import { effectiveScopes } from './oidc-scopes'

/**
 * Sent when a provider has no explicit preference. The account picker stops an
 * admin who typed one address being silently signed in as whoever the provider
 * already has a session for — worth keeping as the default, though not every
 * provider implements it.
 */
export const DEFAULT_OIDC_PROMPT = 'select_account'

/** Credentials in the request body. The other common choice is HTTP Basic. */
export const DEFAULT_TOKEN_AUTH_METHOD = 'post'

/**
 * `omit` is not an OIDC value — it is our way of saying "send no prompt at
 * all", which is emphatically NOT the same as `none`. Omitting leaves the
 * provider to behave normally; `none` demands it render no interface and fail
 * outright when nobody is signed in. Collapsing the two is the plausible
 * simplification that silently breaks sign-in, so they stay separate choices
 * and the dangerous one is labelled by its consequence.
 */
export const PROMPT_CHOICES = [
  { value: 'select_account', label: 'Show the account picker' },
  { value: 'login', label: 'Re-authenticate' },
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
  scopes: string | null
  prompt: string | null
  tokenEndpointAuthMethod: string | null
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
    scopes: effectiveScopes(provider),
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
 * `prompt_values_supported` means UNKNOWN rather than unsupported — the field
 * is optional metadata and almost nobody publishes it, so treating silence as
 * refusal would flag every provider.
 */
export function supportsPrompt(
  prompt: string | undefined,
  supported: readonly string[] | null | undefined
): boolean {
  if (!prompt) return true
  if (!supported || supported.length === 0) return true
  return supported.includes(prompt)
}
