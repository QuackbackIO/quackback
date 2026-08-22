/**
 * Fleet-internal HTTP executor. Session-mode DDL must not run on web;
 * provision may pass a DSN because the registry row does not exist yet.
 */
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  BUNDLED_MIGRATIONS,
  latestBundledVersion,
  tagForVersion,
} from '@quackback/db/schema-version'
import { authorizeFleetInternal } from './internal-auth'
import { shouldServeFleetMigrate } from '@/lib/server/process-role'
import {
  migrateDirect,
  planWorkspace,
  requireWorkspace,
  runReconcilePass,
  type MigrateWorkspaceResult,
} from './migrator'
import { parseSessionModeDsn, SessionModeDsnError } from './session-dsn'
import { explainUnclaimed } from './schema-state'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'fleet-migrate-http' })
const MAX_BODY_BYTES = 64 * 1024

export function refuseIfNotMigrateRole(): Response | null {
  if (shouldServeFleetMigrate()) return null
  return Response.json({ error: 'not_found' }, { status: 404 })
}

export function refuseIfUnauthorized(request: Request): Response | null {
  if (authorizeFleetInternal(request)) return null
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}

function gate(request: Request): Response | null {
  return refuseIfNotMigrateRole() ?? refuseIfUnauthorized(request)
}

function workerId(): string {
  return `http:${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
}

function workspaceKeyOf(body: Record<string, unknown>): string | null {
  const raw = body.workspaceKey ?? body.tenantId
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
}

function summarizeOutcome(outcome: MigrateWorkspaceResult) {
  return {
    workspaceKey: outcome.workspaceKey,
    ok: outcome.ok,
    code: outcome.code,
    detail: outcome.detail,
    replaySet: outcome.replaySet,
    durationMs: outcome.durationMs,
  }
}

function statusForOutcome(outcome: MigrateWorkspaceResult): number {
  if (outcome.ok) return 200
  if (outcome.code === 'invalid_dsn') return 400
  if (
    outcome.code === 'refused_ledger_gap' ||
    outcome.code === 'refused_replay_mutates' ||
    outcome.code === 'refused_pooled_dsn'
  ) {
    return 409
  }
  return 500
}

class PayloadTooLarge extends Error {
  constructor() {
    super('payload_too_large')
    this.name = 'PayloadTooLarge'
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.byteLength
    if (n > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      throw new PayloadTooLarge()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(n)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function readJsonObject(
  request: Request
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const n = Number(declared)
    if (!Number.isFinite(n) || n < 0 || n > MAX_BODY_BYTES) {
      return { ok: false, response: Response.json({ error: 'payload_too_large' }, { status: 413 }) }
    }
  }
  let bytes: Uint8Array
  try {
    bytes = await readBoundedBody(request)
  } catch (err) {
    if (err instanceof PayloadTooLarge) {
      return { ok: false, response: Response.json({ error: 'payload_too_large' }, { status: 413 }) }
    }
    return { ok: false, response: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return { ok: false, response: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, response: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
  return { ok: true, body: parsed as Record<string, unknown> }
}

export async function handleMigrateBundle(request: Request): Promise<Response> {
  const refused = gate(request)
  if (refused) return refused
  const latestVersion = latestBundledVersion()
  return Response.json({
    latestVersion,
    latestTag: tagForVersion(latestVersion),
    count: BUNDLED_MIGRATIONS.length,
  })
}

export async function handleMigratePlan(request: Request): Promise<Response> {
  const refused = gate(request)
  if (refused) return refused
  const parsed = await readJsonObject(request)
  if (!parsed.ok) return parsed.response
  const workspaceKey = workspaceKeyOf(parsed.body)
  if (!workspaceKey) return Response.json({ error: 'workspace_required' }, { status: 400 })
  try {
    const workspace = await requireWorkspace(workspaceKey)
    const plan = await planWorkspace(workspace)
    return Response.json({
      workspaceKey,
      applied: { count: plan.applied.count, max: plan.applied.max },
      gap: plan.gap
        ? {
            missing: plan.gap.missing,
            rewrites: plan.gap.rewrites,
            unrewritable: plan.gap.unrewritable,
            from: plan.gap.from,
          }
        : null,
      replaySet: plan.replaySet,
      refusal: plan.refusal,
      verdicts: plan.verdicts.map((v) => ({
        tag: v.tag,
        verdict: v.verdict,
        mutating: v.mutating.length,
        erroring: v.erroring.length,
      })),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log.warn({ workspaceKey, detail }, 'migrate.plan refused')
    return Response.json({ error: 'not_servable', detail }, { status: 404 })
  }
}

export async function handleMigratePost(request: Request): Promise<Response> {
  const refused = gate(request)
  if (refused) return refused
  const parsed = await readJsonObject(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const workspaceKey = workspaceKeyOf(body)
  if (!workspaceKey) return Response.json({ error: 'workspace_required' }, { status: 400 })
  const databaseUrl = typeof body.databaseUrl === 'string' ? body.databaseUrl : null

  if (databaseUrl) {
    try {
      parseSessionModeDsn(databaseUrl)
    } catch (err) {
      if (err instanceof SessionModeDsnError && err.reason === 'pooled') {
        return Response.json({ error: 'refused_pooled_dsn' }, { status: 409 })
      }
      return Response.json({ error: 'invalid_dsn' }, { status: 400 })
    }
    log.info({ workspaceKey }, 'migrate.direct')
    try {
      const outcome = await migrateDirect(workspaceKey, databaseUrl)
      return Response.json(summarizeOutcome(outcome), { status: statusForOutcome(outcome) })
    } catch (err) {
      log.warn(
        { workspaceKey, err: err instanceof Error ? err.name : 'error' },
        'migrate.direct threw'
      )
      return Response.json({ error: 'migrate_failed' }, { status: 500 })
    }
  }

  log.info({ workspaceKey }, 'migrate.reconcile')
  const result = await runReconcilePass({
    workerId: workerId(),
    workspaceKey,
    concurrency: 1,
    maxWorkspaces: 1,
    leaseMs: 900_000,
  })
  if (result.claimed === 0) {
    const why = await explainUnclaimed(workspaceKey)
    if (why.kind === 'already_current') {
      try {
        const { gap } = await planWorkspace(await requireWorkspace(workspaceKey))
        if (gap) {
          return Response.json(
            {
              error: 'ledger_gap_at_target',
              detail: why.detail,
              missing: gap.missing,
            },
            { status: 409 }
          )
        }
      } catch {
        // already_current with an unreadable workspace is still current
      }
      return Response.json({ ok: true, code: 'already_current', detail: why.detail, claimed: 0 })
    }
    return Response.json({ error: why.kind, detail: why.detail, claimed: 0 }, { status: 409 })
  }
  const outcome = result.outcomes[0]
  if (!outcome) {
    return Response.json({ error: 'empty_outcome', claimed: result.claimed }, { status: 500 })
  }
  return Response.json(
    { ...summarizeOutcome(outcome), claimed: result.claimed },
    { status: result.failed > 0 ? statusForOutcome(outcome) : 200 }
  )
}
