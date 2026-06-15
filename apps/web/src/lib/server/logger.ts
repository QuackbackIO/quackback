/**
 * Structured application logger (Pino).
 *
 * Emits flat NDJSON to stdout — one JSON object per line — for ingestion by
 * Grafana Loki / the LGTM stack. Every line automatically carries:
 *   - service_name, env            (static bindings)
 *   - level (string), time, msg    (Pino, with string level for Loki)
 *   - request_id, route, tenant_id, user_id   (from the ALS request context)
 *   - trace_id, span_id            (from the active OpenTelemetry span, if any)
 *
 * Usage:
 *   import { logger } from '@/lib/server/logger'
 *   logger.info({ post_id }, 'post created')
 *   const log = logger.child({ job: 'feedback-ai' })   // explicit sub-scope
 *
 * Server-only: imports pino + node:async_hooks. Lives under lib/server/ and
 * must never be reached from client/isomorphic modules. Do NOT use an
 * in-process Pino transport in production (fragile under Bun) — write NDJSON to
 * stdout and let the collector (Alloy) ship it.
 */
import pino from 'pino'
import { context, trace } from '@opentelemetry/api'
import { getLogContext } from './log-context'

export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'silent'

const SERVICE_NAME = 'quackback-web'

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
  'refreshToken',
  'apiKey',
  'api_key',
  'secret',
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
  /** Extra static bindings merged into every line. */
  base?: Record<string, unknown>
}

/**
 * Build a logger instance. Prefer the shared {@link logger} singleton; this
 * factory exists so tests can inject a capture stream and an explicit level.
 */
export function createLogger(options: CreateLoggerOptions = {}): pino.Logger {
  const env = process.env.NODE_ENV ?? 'development'
  const level = options.level ?? (env === 'production' ? 'info' : 'debug')

  const pinoOptions: pino.LoggerOptions = {
    level,
    base: { service_name: SERVICE_NAME, env, ...options.base },
    // String level (e.g. "info") so Grafana/Loki level detection works.
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, remove: true },
    serializers: { err: pino.stdSerializers.err },
    mixin,
  }

  return options.destination
    ? pino(pinoOptions, options.destination)
    : pino(pinoOptions)
}

/** Shared application logger. Level comes from config (LOG_LEVEL). */
export const logger: pino.Logger = createLogger({
  level: resolveLevel(),
})

/**
 * Read LOG_LEVEL lazily without importing config (which validates the whole
 * env). Falls back to env-appropriate defaults. config.logLevel is the
 * documented knob; this keeps the logger importable very early in boot.
 */
function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  const allowed: LogLevel[] = [
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
    'silent',
  ]
  if (raw && (allowed as string[]).includes(raw)) return raw as LogLevel
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}
