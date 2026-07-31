/**
 * Custom-action execution engine (QUINN-TWO-AGENT-SPEC D6/Phase 5): the pure
 * template-substitution + allowlist-projection helpers and the one HTTP-request
 * seam both the model runtime and the admin Test button share. Kept apart from
 * `custom-actions.service.ts` (CRUD + encryption + registration) so the
 * scoping/escaping logic — the security-critical core — lives on its own.
 *
 * Server-only (uses `safeFetch`), but touches neither the db nor crypto.
 */
import { z } from 'zod'
import { safeFetch, SsrfError } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-custom-actions-execute' })

/** Hard per-request execution ceiling (spec: ~10s). */
export const ACTION_REQUEST_TIMEOUT_MS = 10_000
/** Hard cap on the buffered response body before allowlist filtering. */
export const ACTION_MAX_RESPONSE_BYTES = 256 * 1024

/**
 * A custom action's SUCCESS output — the only thing that reaches the model.
 * `data` is the JSON-serialized ALLOWLISTED projection of the response, capped
 * to the definition's `responseCharLimit`; nothing outside the allowlist is
 * ever included. `ok` reflects the HTTP outcome; a transport/SSRF failure
 * returns `ok: false` with a graceful `note` instead of throwing into the loop.
 */
export const customActionOutputSchema = z.object({
  ok: z.boolean(),
  httpStatus: z.number().int().optional(),
  data: z.string(),
  note: z.string().optional(),
})
export type CustomActionOutput = z.infer<typeof customActionOutputSchema>

/**
 * Substitute `{{name}}` placeholders using per-context escaping. `url` context
 * percent-encodes each value (so a value can never restructure the URL); `json`
 * context escapes for a JSON string literal (the common `{"q":"{{v}}"}` body
 * shape). Only declared variable names are substituted; an undeclared
 * placeholder is left literal (create-time validation forbids those anyway).
 */
export function substituteTemplate(
  template: string,
  values: Record<string, string>,
  context: 'url' | 'json'
): string {
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) return whole
    const raw = values[name] ?? ''
    if (context === 'url') return encodeURIComponent(raw)
    // JSON string-literal escaping: JSON.stringify a string yields a quoted,
    // fully-escaped literal; strip the surrounding quotes to inline it.
    return JSON.stringify(raw).slice(1, -1)
  })
}

interface PathSegment {
  key: string
  array: boolean
}

function parseAllowlistPath(path: string): PathSegment[] {
  return path.split('.').map((raw) => {
    const array = raw.endsWith('[]')
    return { key: array ? raw.slice(0, -2) : raw, array }
  })
}

/** Walk one allowlist path into a JSON value, fanning out across `[]` arrays. */
function selectPath(node: unknown, segments: PathSegment[]): unknown {
  if (segments.length === 0) return node
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
  const [seg, ...rest] = segments
  const child = (node as Record<string, unknown>)[seg.key]
  if (child === undefined) return undefined
  if (seg.array) {
    if (!Array.isArray(child)) return undefined
    return child.map((element) => selectPath(element, rest)).filter((value) => value !== undefined)
  }
  return selectPath(child, rest)
}

/**
 * Project ONLY the allowlisted fields out of a parsed response. The result is a
 * flat map keyed by each allowlist path (unambiguous and trivially safe — a
 * value the model sees corresponds to exactly one allowed path). An empty
 * allowlist yields an empty projection: no response fields are exposed.
 */
export function projectAllowlisted(
  parsed: unknown,
  allowlist: readonly string[]
): Record<string, unknown> {
  const projection: Record<string, unknown> = {}
  for (const path of allowlist) {
    const value = selectPath(parsed, parseAllowlistPath(path))
    if (value !== undefined) projection[path] = value
  }
  return projection
}

/** Serialize a projection and hard-cap it to `charLimit`, flagging truncation. */
export function capSerializedResponse(
  projection: Record<string, unknown>,
  charLimit: number
): { data: string; truncated: boolean } {
  const serialized = JSON.stringify(projection)
  if (serialized.length <= charLimit) return { data: serialized, truncated: false }
  return { data: serialized.slice(0, charLimit), truncated: true }
}

export interface PerformActionRequestInput {
  method: 'GET' | 'POST'
  url: string
  /** Header name -> plaintext value (secrets already decrypted). */
  headers: Record<string, string>
  body: string | null
  variables: Record<string, string>
  responseAllowlist: readonly string[]
  responseCharLimit: number
}

export interface PerformActionRequestResult extends CustomActionOutput {
  truncated?: boolean
}

/**
 * Execute one custom-action HTTP request end to end: substitute variables with
 * strict escaping, SSRF-check + fetch (pinned IP, no redirects, bounded body),
 * then filter the response through the allowlist and char cap. Never throws:
 * an SSRF rejection, timeout, or non-JSON body resolves to a graceful,
 * model-safe result. The one seam both the model runtime and the test button
 * share, so their escaping/scoping can never drift.
 */
export async function performActionRequest(
  input: PerformActionRequestInput
): Promise<PerformActionRequestResult> {
  const url = substituteTemplate(input.url, input.variables, 'url')
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers)) {
    if (value.length > 0) headers[name] = value
  }
  let body: string | undefined
  if (input.method === 'POST') {
    body = substituteTemplate(input.body ?? '', input.variables, 'json')
    const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')
    if (!hasContentType) headers['content-type'] = 'application/json'
  }

  let response: Response
  try {
    response = await safeFetch(url, {
      method: input.method,
      headers,
      body,
      timeoutMs: ACTION_REQUEST_TIMEOUT_MS,
      maxResponseBytes: ACTION_MAX_RESPONSE_BYTES,
      onOverflow: 'truncate',
    })
  } catch (err) {
    if (err instanceof SsrfError) {
      return { ok: false, data: '', note: 'The action target is not an allowed address.' }
    }
    log.warn({ err }, 'custom action request failed')
    return { ok: false, data: '', note: 'The action request could not be completed.' }
  }

  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Only JSON responses can be allowlist-scoped; anything else is withheld.
    return {
      ok: response.ok,
      httpStatus: response.status,
      data: '',
      note: 'The action responded with a non-JSON body, which is not shown to the assistant.',
    }
  }

  const projection = projectAllowlisted(parsed, input.responseAllowlist)
  const { data, truncated } = capSerializedResponse(projection, input.responseCharLimit)
  const notes: string[] = []
  if (input.responseAllowlist.length === 0) {
    notes.push('No response fields are allowlisted, so the response body is hidden.')
  }
  if (truncated) notes.push('The response was truncated to fit the size limit.')
  return {
    ok: response.ok,
    httpStatus: response.status,
    data,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    truncated,
  }
}
