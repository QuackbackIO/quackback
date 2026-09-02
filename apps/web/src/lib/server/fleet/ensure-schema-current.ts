/**
 * Bring a workspace database up to this build's bundled schema before serving it.
 *
 * New cloud workspaces are migrated by the control plane's vendored `migrate.mjs`.
 * That snapshot lags the serving image (SAAS-HOSTING-STACK vendor-lag: "broken
 * newborns"). Drizzle emits explicit column lists, so a build that postdates an
 * additive migration throws on ordinary reads — the settings fetch that 500s
 * every page when `widget_installed_sdk_version` is absent.
 *
 * The hourly fleet-migrator pass will catch these up, but a mint is Ready and
 * routed immediately. This runs once per pool, after identity checks, and is a
 * no-op when the ledger already records every bundled migration.
 *
 * Catch-up goes through {@link migrateDirect}, not raw `runMigrations`. Drizzle
 * only applies a suffix above the ledger high-water mark, so a hole below the
 * tip would otherwise 503-loop on every checkout. `migrateDirect` is the
 * gap-aware planner that can truncate and replay, or refuse a mutating replay.
 *
 * Uses the session-mode DSN: the advisory lock is session-scoped.
 */
import type { Sql } from 'postgres'
import {
  BUNDLED_MIGRATIONS,
  readAppliedLedger,
  type AppliedLedger,
} from '@quackback/db/schema-version'
import { logger } from '@/lib/server/logger'
import { WorkspaceSchemaFloorRefusal } from './schema-floor'

const log = logger.child({ component: 'ensure-schema-current' })

export function missingBundledMigrations(applied: AppliedLedger): string[] {
  return BUNDLED_MIGRATIONS.filter((e) => !applied.versions.has(e.when)).map((e) => e.tag)
}

export async function ensureWorkspaceSchemaCurrent(opts: {
  workspaceKey: string
  sql: Sql
  directConnectionString: string
}): Promise<void> {
  const applied = await readAppliedLedger(opts.sql)
  const missing = missingBundledMigrations(applied)
  if (missing.length === 0) return

  log.warn(
    { workspaceKey: opts.workspaceKey, missing: missing.slice(0, 8), missingCount: missing.length },
    'workspace schema is behind this build — migrating before serving'
  )

  // Dynamic import: migrator.ts imports pool-cache for the registry-backed
  // wrapper, and pool-cache calls this module on checkout.
  const { migrateDirect } = await import('./migrator')
  const outcome = await migrateDirect(opts.workspaceKey, opts.directConnectionString)
  if (!outcome.ok) {
    log.error(
      {
        workspaceKey: opts.workspaceKey,
        code: outcome.code,
        detail: outcome.detail,
        gap: outcome.gap?.missing,
      },
      'workspace catch-up migrate refused or failed'
    )
    throw new WorkspaceSchemaFloorRefusal(opts.workspaceKey, {
      ok: false,
      missing: outcome.gap?.missing ?? missing,
      floorTag: missing[missing.length - 1] ?? 'bundled',
    })
  }

  const after = outcome.after ?? (await readAppliedLedger(opts.sql))
  const stillMissing = missingBundledMigrations(after)
  if (stillMissing.length > 0) {
    throw new WorkspaceSchemaFloorRefusal(opts.workspaceKey, {
      ok: false,
      missing: stillMissing,
      floorTag: stillMissing[stillMissing.length - 1] ?? 'bundled',
    })
  }
}
