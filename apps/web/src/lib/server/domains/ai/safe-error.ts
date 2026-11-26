/**
 * Logging-only strict enumerated error projection for AI provider failures:
 * never emits free-form error messages, URLs, headers, prompts, or response
 * bodies so customer text cannot leak into logs, `ai_usage_log`, or spans.
 */

export type AiErrorClass =
  | 'quota_refused'
  | 'rate_limited'
  | 'upstream_4xx'
  | 'upstream_5xx'
  | 'timeout'
  | 'network_error'
  | 'auth_error'
  | 'schema_invalid'
  | 'content_filtered'
  | 'unknown'

export type AiFinishReason =
  'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error' | 'unknown'

export type AiErrorStage =
  | 'assistant'
  | 'help_center_answers'
  | 'inbox_translation'
  | 'classification'
  | 'conversation_summary'
  | 'extraction'
  | 'sentiment'
  | 'quality_gate'
  | 'merge_check'
  | 'merge_assessment'
  | 'embedding'
  | 'document_ingest'
  | 'copilot_transform'
  | 'copilot_summary'
  | 'structured_chat'
  | 'retry'
  | 'other'

export interface SafeAIErrorContext {
  attempt?: unknown
  stage?: unknown
  finishReason?: unknown
}

export interface SafeAIErrorPayload {
  httpStatus: number | null
  errorClass: AiErrorClass
  finishReason: AiFinishReason | null
  attempt: number | null
  stage: AiErrorStage | null
}

const VALID_FINISH_REASONS = new Set<string>([
  'stop',
  'length',
  'content_filter',
  'tool_calls',
  'error',
  'unknown',
])

const VALID_ERROR_STAGES = new Set<string>([
  'assistant',
  'help_center_answers',
  'inbox_translation',
  'classification',
  'conversation_summary',
  'extraction',
  'sentiment',
  'quality_gate',
  'merge_check',
  'merge_assessment',
  'embedding',
  'document_ingest',
  'copilot_transform',
  'copilot_summary',
  'structured_chat',
  'retry',
  'other',
])

const NETWORK_ERROR_CODES = new Set<string>([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT',
])

function safeOwnValue(target: unknown, key: string): unknown {
  if (!target || typeof target !== 'object') return undefined
  try {
    const desc = Object.getOwnPropertyDescriptor(target, key)
    if (desc) {
      return 'value' in desc ? desc.value : undefined
    }
    if (
      (key === 'name' || key === 'message') &&
      (target instanceof Error ||
        (typeof DOMException === 'function' && target instanceof DOMException))
    ) {
      const value = key === 'name' ? target.name : target.message
      return typeof value === 'string' ? value : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

function safeLowerString(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function safeHeaderValue(headers: unknown, name: string): string {
  if (!headers || typeof headers !== 'object') return ''
  try {
    if (headers instanceof Headers) {
      return (headers.get(name) ?? '').toLowerCase()
    }
    const lower = name.toLowerCase()
    for (const key of Object.keys(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === lower) {
        const val = safeOwnValue(headers, key)
        if (typeof val === 'string') return val.toLowerCase()
      }
    }
  } catch {
    return ''
  }
  return ''
}

function extractHttpStatus(node: unknown): number | null {
  for (const key of ['status', 'statusCode', 'responseStatus']) {
    const raw = safeOwnValue(node, key)
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 599) {
      return raw
    }
  }
  const response = safeOwnValue(node, 'response')
  if (response && typeof response === 'object') {
    const raw = safeOwnValue(response, 'status')
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 599) {
      return raw
    }
  }
  return null
}

function extractFinishReason(value: unknown): AiFinishReason | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return VALID_FINISH_REASONS.has(normalized) ? (normalized as AiFinishReason) : null
}

function extractAttempt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100) {
    return value
  }
  return null
}

function extractStage(value: unknown): AiErrorStage | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  return VALID_ERROR_STAGES.has(normalized) ? (normalized as AiErrorStage) : 'other'
}

function walkErrorChain(root: unknown): unknown[] {
  const nodes: unknown[] = []
  const seen = new WeakSet<object>()
  let cursor: unknown = root
  for (let depth = 0; depth < 6 && cursor && typeof cursor === 'object'; depth++) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    nodes.push(cursor)
    cursor = safeOwnValue(cursor, 'cause')
  }
  return nodes
}

function classifyError(
  nodes: unknown[],
  httpStatus: number | null,
  finishReason: AiFinishReason | null
): AiErrorClass {
  let sawQuota = false
  let sawRateLimit = false
  let sawAuth = false
  let sawContentFilter = finishReason === 'content_filter'
  let sawSchemaInvalid = false
  let sawTimeout = false
  let sawNetwork = false

  for (const node of nodes) {
    const name = safeLowerString(safeOwnValue(node, 'name'))
    const codeRaw = safeOwnValue(node, 'code')
    const code = safeLowerString(codeRaw)
    const message = safeLowerString(safeOwnValue(node, 'message'))
    const nestedError = safeOwnValue(node, 'error')
    const nestedCode = safeLowerString(safeOwnValue(nestedError, 'code'))
    const nestedType = safeLowerString(safeOwnValue(nestedError, 'type'))
    const nestedMsg = safeLowerString(safeOwnValue(nestedError, 'message'))
    const headers = safeOwnValue(node, 'headers')
    const shouldRetryHeader = safeHeaderValue(headers, 'x-should-retry')

    if (
      code === 'quota_refused' ||
      code === 'insufficient_quota' ||
      code === 'ai_quota_misconfigured' ||
      nestedCode === 'quota_refused' ||
      nestedCode === 'insufficient_quota' ||
      nestedCode === 'ai_quota_misconfigured' ||
      name === 'quotaexceedederror' ||
      /ai daily quota exceeded|ai burst rate limit exceeded|daily_limit|burst_limit|quota_refused|insufficient_quota/.test(
        `${message} ${nestedMsg}`
      ) ||
      (httpStatus === 429 && shouldRetryHeader === 'false')
    ) {
      sawQuota = true
    }

    if (
      code === 'rate_limit_exceeded' ||
      nestedCode === 'rate_limit_exceeded' ||
      name === 'ratelimiterror'
    ) {
      sawRateLimit = true
    }

    if (
      name === 'authenticationerror' ||
      name === 'permissiondeniederror' ||
      code === 'invalid_api_key' ||
      nestedCode === 'invalid_api_key' ||
      nestedType === 'authentication_error'
    ) {
      sawAuth = true
    }

    if (
      code === 'content_filter' ||
      nestedCode === 'content_filter' ||
      /content_filter|content_policy_violation/.test(`${message} ${nestedMsg}`)
    ) {
      sawContentFilter = true
    }

    if (
      name === 'assistantcompletionerror' ||
      name === 'zoderror' ||
      code === 'structured-output-missing-result' ||
      code === 'structured-output-parse-failed' ||
      code === 'non_conformant_output'
    ) {
      sawSchemaInvalid = true
    }

    if (
      name === 'aborterror' ||
      name === 'timeouterror' ||
      name === 'aitimeouterror' ||
      code === 'etimedout' ||
      code === 'und_err_connect_timeout' ||
      /\b(timed?\s*out|timeout|aborted)\b/.test(message)
    ) {
      sawTimeout = true
    }

    if (
      (typeof codeRaw === 'string' && NETWORK_ERROR_CODES.has(codeRaw.toUpperCase())) ||
      name === 'apiconnectionerror' ||
      /\b(econnreset|econnrefused|enotfound|eai_again|socket hang up|fetch failed|network error)\b/.test(
        message
      )
    ) {
      sawNetwork = true
    }
  }

  if (sawQuota) return 'quota_refused'
  if (httpStatus === 401 || httpStatus === 403 || sawAuth) return 'auth_error'
  if (httpStatus === 429 || sawRateLimit) return 'rate_limited'
  if (sawContentFilter) return 'content_filtered'
  if (sawSchemaInvalid) return 'schema_invalid'
  if (httpStatus === 408 || httpStatus === 504 || sawTimeout) return 'timeout'
  if (sawNetwork) return 'network_error'
  if (httpStatus !== null && httpStatus >= 500 && httpStatus <= 599) return 'upstream_5xx'
  if (httpStatus !== null && httpStatus >= 400 && httpStatus <= 499) return 'upstream_4xx'
  return 'unknown'
}

export function safeAIError(error: unknown, context?: SafeAIErrorContext): SafeAIErrorPayload {
  try {
    const nodes = walkErrorChain(error)
    let httpStatus: number | null = null
    let finishReason = extractFinishReason(context?.finishReason)
    let attempt = extractAttempt(context?.attempt)

    for (const node of nodes) {
      if (httpStatus === null) httpStatus = extractHttpStatus(node)
      if (finishReason === null) {
        finishReason = extractFinishReason(safeOwnValue(node, 'finishReason'))
      }
      if (attempt === null) {
        attempt = extractAttempt(safeOwnValue(node, 'retryCount') ?? safeOwnValue(node, 'attempt'))
      }
    }

    const errorClass = classifyError(nodes, httpStatus, finishReason)
    const stage = extractStage(context?.stage)
    return { httpStatus, errorClass, finishReason, attempt, stage }
  } catch {
    return {
      httpStatus: null,
      errorClass: 'unknown',
      finishReason: null,
      attempt: null,
      stage: null,
    }
  }
}
