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
 * Uses the session-mode DSN: `runMigrations` refuses a transaction-mode pooler
 * because the advisory lock is session-scoped.
 */
import type { Sql } from 'postgres'
import { runMigrations } from '@quackback/db/migrate'
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

  const result = await runMigrations(opts.directConnectionString)
  if (result.postconditions && !result.postconditions.ok) {
    log.error(
      {
        workspaceKey: opts.workspaceKey,
        violations: result.postconditions.violations.map((v) => v.detail),
      },
      'workspace migrate completed but post-conditions failed'
    )
    throw new WorkspaceSchemaFloorRefusal(opts.workspaceKey, {
      ok: false,
      missing,
      floorTag: missing[missing.length - 1] ?? 'bundled',
    })
  }

  const after = await readAppliedLedger(opts.sql)
  const stillMissing = missingBundledMigrations(after)
  if (stillMissing.length > 0) {
    throw new WorkspaceSchemaFloorRefusal(opts.workspaceKey, {
      ok: false,
      missing: stillMissing,
      floorTag: stillMissing[stillMissing.length - 1] ?? 'bundled',
    })
  }
}
