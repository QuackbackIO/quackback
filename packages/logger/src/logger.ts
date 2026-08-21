/**
 * Structured application logger (Pino) — shared across the workspace.
 *
 * Emits flat NDJSON to stdout — one JSON object per line — for ingestion by a
 * log shipper (Grafana Alloy, Promtail, Fluent Bit, Vector, ...). Every line
 * carries:
 *   - service_name                 (static binding)
 *   - level (string), time, msg    (Pino, string level for level detection)
 *   - request_id, route, workspace_key, user_id   (from the shared ALS context)
 *   - trace_id, span_id            (from the active OpenTelemetry span, if any)
 *
 * `service_name` defaults from OTEL_SERVICE_NAME (else "quackback"); each app
 * passes its own via `base`. Do NOT use an in-process Pino transport in
 * production (fragile under Bun) — write NDJSON to stdout and let the collector
 * ship it.
 *
 * Server-only: imports pino + node:async_hooks (via ./context).
 */
import pino from 'pino'
import { context, trace } from '@opentelemetry/api'
import { getLogContext } from './context'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'

/**
 * Secret/PII paths stripped from every log line. Redaction is a backstop —
 * the primary rule is "log IDs, not payloads". `remove: true` drops the key
 * entirely so secrets never reach the log store.
 *
 * Two limits of Pino's matcher bound what this list can do, and both are
 * reasons the "log IDs, not payloads" rule still has to hold:
 *   - segments match exactly, so a key whose name is assembled at runtime
 *     (a provider or vendor name spliced into `X_<NAME>_SECRET`) cannot be
 *     expressed here at all;
 *   - `*` matches exactly one level, so `*.clientSecret` covers a value one
 *     object deep and nothing below it.
 * Callers holding a map of credentials keyed by name must therefore mask it
 * themselves before it reaches a log call.
 */
const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'apiKey',
  '*.apiKey',
  'api_key',
  'secret',
  '*.secret',
  'widgetSecret',
  'email',
  '*.email',
  'user.email',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  // Hyphenated keys require bracket notation in Pino redact paths; bare/dotted
  // `set-cookie` only catches the top level and leaks nested header locations.
  // set-cookie is a response header, so cover the realistic shapes.
  '["set-cookie"]',
  'headers["set-cookie"]',
  'req.headers["set-cookie"]',
  'request.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'response.headers["set-cookie"]',
  // Credential field names used by OAuth apps, signed webhooks and bots. None
  // of them contain `secret` or `token` as a whole path segment, so every one
  // slips past the exact-match entries above.
  'clientSecret',
  '*.clientSecret',
  'signingSecret',
  '*.signingSecret',
  'botToken',
  '*.botToken',
  // Wrapper field names. The realistic leak is not a hand-picked secret key,
  // it is a reflexive `log.error({ input }, 'validation failed')` that ships
  // the whole submitted object. Drop the container: whatever a caller nests
  // inside it cannot be enumerated in advance.
  'values',
  '*.values',
  'fields',
  '*.fields',
  'draft',
  '*.draft',
  'input',
  '*.input',
  'payload',
  '*.payload',
  'sealedPayload',
  '*.sealedPayload',
  // Bracket notation for credential keys that are not valid identifiers:
  // hyphenated object-storage keys and the dot-prefixed registry pull secret.
  '["access-key-id"]',
  '*["access-key-id"]',
  '["secret-access-key"]',
  '*["secret-access-key"]',
  '[".dockerconfigjson"]',
  '*[".dockerconfigjson"]',
]

/**
 * Merge ambient request context + active trace context into every line.
 * Reads the OTel active span defensively: when no SDK/span is active,
 * `trace.getSpan` returns undefined and no trace fields are added — so this is
 * a no-op until tracing is wired, then logs auto-correlate to Tempo.
 */
function mixin(): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...getLogContext() }
  const span = trace.getSpan(context.active())
  if (span) {
    const sc = span.spanContext()
    if (sc.traceId) {
      fields.trace_id = sc.traceId
      fields.span_id = sc.spanId
    }
  }
  return fields
}

export interface CreateLoggerOptions {
  level?: LogLevel
  /** Override the destination stream (tests capture output this way). */
  destination?: pino.DestinationStream
  /** Extra static bindings merged into every line (e.g. service_name). */
  base?: Record<string, unknown>
}

function defaultLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  const allowed: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
  // info everywhere except tests, which default to silent to keep test output
  // clean (LOG_LEVEL still overrides). Bump to debug locally when tracing.
  const fallback: LogLevel = process.env.NODE_ENV === 'test' ? 'silent' : 'info'
  if (!raw) return fallback
  if ((allowed as string[]).includes(raw)) return raw as LogLevel
  console.warn(`[logger] invalid LOG_LEVEL "${raw}", falling back to ${fallback}`)
  return fallback
}

/** Opaque logger type — use this instead of importing directly from pino. */
export type AppLogger = pino.Logger

/**
 * Build a logger instance. Consumers usually pass `base.service_name`; the
 * default falls back to OTEL_SERVICE_NAME then "quackback".
 */
export function createLogger(options: CreateLoggerOptions = {}): pino.Logger {
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'quackback'

  const pinoOptions: pino.LoggerOptions = {
    level: options.level ?? defaultLevel(),
    base: { service_name: serviceName, ...options.base },
    // String level (e.g. "info") so Grafana/Loki level detection works.
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, remove: true },
    serializers: { err: pino.stdSerializers.err },
    mixin,
  }

  return options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions)
}
