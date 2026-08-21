/**
 * Running background work for every workspace.
 *
 * SAAS-HOSTING-STACK.md §5, caveat 3: roughly 25–35 files across ~15 background
 * subsystems run with no request scope at all — sweeps, queues, the relay,
 * migrations, CLI backfills, the readiness probe. Each needs a workspace scope, and
 * each needs a per-subsystem answer to one question: *iterate all workspaces per
 * tick, or give each workspace its own schedule?*
 *
 * This module is the "iterate all workspaces per tick" answer, which is the right
 * one for everything already shaped as a periodic sweep. Per-workspace scheduling
 * is a Postgres-queue concern and belongs with the lease primitive, not here.
 *
 * Two properties are deliberate.
 *
 * **Single-workspace behaviour is untouched.** Under `QUACKBACK_TENANCY=single`
 * `runFleetPass` calls the body exactly once, with no scope, exactly as the
 * sweeper does today. Self-hosted installs get no new machinery and no new
 * failure modes.
 *
 * **One workspace's failure never ends the pass.** A sweep that aborted the fleet
 * because workspace 7 of 400 had a refused fingerprint would turn a single bad
 * record into a fleet-wide outage of every sweeper. Failures are counted,
 * logged with their workspace, and the pass continues — which is the same choice
 * `listActiveWorkspaces` makes when it drops refused records rather than throwing.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { listActiveWorkspaces, type WorkspaceDescriptor } from './registry'
import { acquireScopeForWorkspaceId, acquireWorkspaceScope } from './resolver'
import { runWithWorkspaceScope, type WorkspaceScopeOrigin } from './workspace-context'

const log = logger.child({ component: 'workspace-fleet' })

export interface FleetPassResult {
  /** Workspaces the body ran to completion for. */
  succeeded: number
  /** Workspaces whose body threw. */
  failed: number
  /** Workspaces that could not be scoped at all (suspended, invalid, refused). */
  skipped: number
}

/**
 * Run `body` once per active workspace, each inside its own workspace scope.
 *
 * Serial on purpose. These are periodic sweeps against per-workspace databases;
 * running them concurrently would wake every suspended workspace database at once,
 * which is the exact cost the architecture exists to avoid.
 */
export async function runFleetPass(
  origin: WorkspaceScopeOrigin,
  body: (workspace: WorkspaceDescriptor | null) => Promise<void>
): Promise<FleetPassResult> {
  if (!config.isPooledTenancy) {
    await body(null)
    return { succeeded: 1, failed: 0, skipped: 0 }
  }

  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) {
    log.error({ refused }, 'fleet pass skipping workspaces with invalid registry records')
  }

  const result: FleetPassResult = { succeeded: 0, failed: 0, skipped: refused.length }

  for (const workspace of workspaces) {
    const acquisition = await acquireWorkspaceScope(workspace, origin)
    if (acquisition.kind !== 'ok') {
      result.skipped += 1
      log.error(
        { workspaceKey: workspace.workspaceKey, kind: acquisition.kind },
        'fleet pass could not scope workspace'
      )
      continue
    }
    try {
      await runWithWorkspaceScope(acquisition.scope, () => body(workspace))
      result.succeeded += 1
    } catch (err) {
      result.failed += 1
      log.error(
        { err, workspaceKey: workspace.workspaceKey },
        'fleet pass body failed for workspace'
      )
    }
  }

  return result
}

/**
 * A scope that could not be opened, with the reason still attached.
 *
 * This used to be a bare `Error` with the kind interpolated into its message,
 * and the loss was not cosmetic: `acquireWorkspaceScope` classifies every refusal
 * with a `code`, and a caller that has to parse prose to recover it cannot tell
 * `app_secret_no_resolver` — which no retry will ever fix — from a compute that
 * is merely still starting. The job tier reconnecting once per second to a
 * workspace refused for the former is precisely what this class exists to let it
 * stop doing.
 */
export class WorkspaceScopeUnavailableError extends Error {
  readonly workspaceKey: string
  readonly kind: string
  readonly code: string
  constructor(
    workspaceKey: string,
    origin: WorkspaceScopeOrigin,
    kind: string,
    code: string,
    detail?: string
  ) {
    super(
      `Cannot open a ${origin} scope for workspace ${workspaceKey}: ${kind}` +
        (detail ? ` — ${detail}` : '')
    )
    this.name = 'WorkspaceScopeUnavailableError'
    this.workspaceKey = workspaceKey
    this.kind = kind
    this.code = code
  }
}

/**
 * Run `body` inside one named workspace's scope.
 *
 * For work that already knows its workspace: a queue job carrying `workspaceKey` in its
 * payload, a CLI script given `--workspace`, the migrator. Throws rather than
 * degrading, because a caller that named a workspace and got a different one (or
 * none) has no safe fallback.
 */
export async function withWorkspaceScopeById<T>(
  workspaceKey: string,
  origin: WorkspaceScopeOrigin,
  body: () => Promise<T>
): Promise<T> {
  const acquisition = await acquireScopeForWorkspaceId(workspaceKey, origin)
  if (acquisition.kind !== 'ok') {
    throw new WorkspaceScopeUnavailableError(
      workspaceKey,
      origin,
      acquisition.kind,
      'code' in acquisition ? acquisition.code : acquisition.kind,
      'detail' in acquisition ? acquisition.detail : undefined
    )
  }
  return runWithWorkspaceScope(acquisition.scope, body)
}
