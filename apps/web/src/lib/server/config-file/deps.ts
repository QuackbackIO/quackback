import { db, settings, eq } from '@/lib/server/db'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { bumpAuthConfigVersionInTx } from '@/lib/server/auth/config-version'
import { generateId } from '@quackback/ids'
import type { ReconcileDeps, SettingsInsert, SettingsRow, SettingsUpdate } from './reconciler'
import { makeReportStatus } from './report-status'

/** Production wiring of `ReconcileDeps`. The reconciler is db-agnostic
 *  to keep its tests fast; this is the only place that touches Drizzle
 *  + Redis. */
export function makeReconcileDeps(): ReconcileDeps {
  return {
    readSettings: async () => {
      const row = await db.query.settings.findFirst()
      if (!row) return null
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        setupState: row.setupState,
        tierLimits: row.tierLimits,
        managedFieldPaths: (row.managedFieldPaths as string[] | null) ?? [],
      } satisfies SettingsRow
    },
    updateSettings: async (update: SettingsUpdate) => {
      const row = await db.query.settings.findFirst({ columns: { id: true } })
      if (!row) return
      // Bump auth_config_version atomically with the settings write so
      // other pods drop their stale Better-Auth instance on next
      // request. invalidateSettingsCache (called by the reconciler
      // after this returns) handles the Redis cross-pod broadcast.
      await db.transaction(async (tx) => {
        await tx.update(settings).set(update).where(eq(settings.id, row.id))
        await bumpAuthConfigVersionInTx(tx)
      })
    },
    createSettings: async (insert: SettingsInsert) => {
      // Pass a TypeID string for the id; the typeIdColumn driver
      // converts it to UUID for storage. createdAt is NOT NULL with no
      // default at the column level, so we set it here.
      //
      // onConflictDoNothing on slug guards the narrow race between this
      // path and onboarding's saveUseCaseFn — both can attempt the
      // first INSERT on a fresh install. If we lose the race, the next
      // watcher tick reads the now-existing row and updates it via the
      // normal reconcile path.
      //
      // authConfigVersion starts at 1 (not the column default of 0) so
      // any pod that built its Better-Auth instance BEFORE this row
      // existed — the proxy records `_authConfigVersion = 0` from the
      // missing-row case — sees a mismatch on its next request and
      // rebuilds. Without this, the cached "no settings row" and the
      // freshly-created "version 0" tie and the stale instance sticks.
      await db
        .insert(settings)
        .values({
          id: generateId('workspace'),
          name: insert.name,
          slug: insert.slug,
          createdAt: new Date(),
          setupState: insert.setupState,
          tierLimits: insert.tierLimits,
          managedFieldPaths: insert.managedFieldPaths,
          authConfigVersion: 1,
        })
        .onConflictDoNothing({ target: settings.slug })
    },
    invalidateSettingsCache: async () => {
      await invalidateSettingsCache()
    },
    invalidateTierLimitsCache: async () => {
      invalidateTierLimitsCache()
    },
    reportStatus: makeReportStatus(),
  }
}
