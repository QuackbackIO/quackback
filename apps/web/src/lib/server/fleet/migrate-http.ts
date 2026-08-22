/**
 * Fleet-internal HTTP executor — the app-image half of SAAS-HOSTING-STACK §10.3.
 *
 * This is a different bridge from the other `/api/internal/*` routes:
 *
 *   - identity/billing projection: CP → **web** (tenant hostname), JWT, applies
 *     a signed blob on the serving replica.
 *   - `/api/v1/internal/*` on the CP: **app** → CP, per-workspace HMAC, tenant
 *     billing/membership/lifecycle.
 *   - this: CP → **worker**, fleet-internal bearer. Session-mode DDL cannot
 *     run on the web replica, so the path is under `/api/internal/fleet/` and
 *     web returns 404.
 *
 * The control plane names a workspace (and, at provision, passes the session
 * DSN because the registry row does not exist yet). This process applies the
 * lineage it ships.
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
  if (
    outcome.code === 'refused_ledger_gap' ||
    outcome.code === 'refused_replay_mutates' ||
    outcome.code === 'refused_pooled_dsn'
  ) {
    return 409
  }
  return 500
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
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const workspaceKey = workspaceKeyOf(body)
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
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const workspaceKey = workspaceKeyOf(body)
  if (!workspaceKey) return Response.json({ error: 'workspace_required' }, { status: 400 })
  const allowMutatingReplay = body.allowMutatingReplay === true
  const databaseUrl = typeof body.databaseUrl === 'string' ? body.databaseUrl : null

  if (databaseUrl) {
    log.info({ workspaceKey }, 'migrate.direct')
    const outcome = await migrateDirect(workspaceKey, databaseUrl, { allowMutatingReplay })
    return Response.json(summarizeOutcome(outcome), { status: statusForOutcome(outcome) })
  }

  log.info({ workspaceKey }, 'migrate.reconcile')
  const result = await runReconcilePass({
    workerId: workerId(),
    workspaceKey,
    concurrency: 1,
    maxWorkspaces: 1,
    leaseMs: 900_000,
    allowMutatingReplay,
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
