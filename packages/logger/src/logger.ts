/**
 * Structured application logger (Pino) — shared across the workspace.
 *
 * Emits flat NDJSON to stdout — one JSON object per line — for ingestion by a
 * log shipper (Grafana Alloy, Promtail, Fluent Bit, Vector, ...). Every line
 * carries:
 *   - service_name, env            (static bindings)
 *   - level (string), time, msg    (Pino, string level for level detection)
 *   - request_id, route, tenant_id, user_id   (from the shared ALS context)
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
  'set-cookie',
  '*.set-cookie',
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
  const fallback: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug'
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
  const env = process.env.NODE_ENV ?? 'development'
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'quackback'

  const pinoOptions: pino.LoggerOptions = {
    level: options.level ?? defaultLevel(),
    base: { service_name: serviceName, env, ...options.base },
    // String level (e.g. "info") so Grafana/Loki level detection works.
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, remove: true },
    serializers: { err: pino.stdSerializers.err },
    mixin,
  }

  return options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions)
}
