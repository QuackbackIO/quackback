import { db, settings, eq } from '@/lib/server/db'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { resetAuth } from '@/lib/server/auth/index'
import { bumpAuthConfigVersionInTx } from '@/lib/server/auth/config-version'
import { generateId } from '@quackback/ids'
import { normalizeDomain } from '@/lib/server/auth/normalize-domain'
import { logger } from '@/lib/server/logger'
import type { ReconcileDeps, SettingsInsert, SettingsRow, SettingsUpdate } from './reconciler'
import { makeReportStatus } from './report-status'

const log = logger.child({ component: 'config-file-deps' })

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
        featureFlags: row.featureFlags,
        authConfig: row.authConfig ?? null,
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
          featureFlags: insert.featureFlags,
          authConfig: insert.authConfig,
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
    resetAuth: async () => {
      resetAuth()
    },
    reportStatus: makeReportStatus(),
    upsertIdentityProviders: async (specs) => {
      if (specs.length === 0) return
      // Services are imported lazily: this path only runs when the file
      // declares providers, and the identity-providers service pulls in
      // the auth runtime — keep it off the common reconcile path and out
      // of deps.ts's load-time import graph.
      const { listIdentityProviders, upsertIdentityProvider } = await import(
        '@/lib/server/domains/settings/identity-providers.service'
      )
      const { insertVerifiedDomain, stampVerifiedDomain, setVerifiedDomainEnforced } = await import(
        '@/lib/server/domains/settings/settings.service'
      )

      // The config carries no id, so providers are matched to existing
      // rows by `label`. A net-new provider gets a stable, unique
      // `oidc_<id>` registrationId minted once; later reconciles reuse it
      // via the label match (so renaming a label forks a new provider).
      const existing = await listIdentityProviders()
      for (const spec of specs) {
        const prior = existing.find((p) => p.label === spec.label)
        const registrationId = prior?.registrationId ?? `oidc_${generateId('idp')}`
        const saved = await upsertIdentityProvider({
          id: prior?.id,
          registrationId,
          label: spec.label,
          clientId: spec.clientId,
          discoveryUrl: spec.discoveryUrl,
          scopes: spec.scopes ?? null,
          enabled: spec.enabled,
          autoCreateUsers: spec.autoCreateUsers,
          autoProvisionRole: spec.autoProvisionRole ?? null,
        })

        for (const domain of spec.domains) {
          // Canonicalise the declared name the same way the UI path does
          // (`verifiableDomain`), so routing/enforcement — which compare
          // against the normalized email domain — actually match. A raw
          // "Acme.com" / trailing-dot / IDN name would silently never route.
          const name = normalizeDomain(domain.name)
          if (!name) {
            log.warn(
              { provider: spec.label, domain: domain.name },
              'config-file: skipping invalid identity-provider domain'
            )
            continue
          }
          // Link (or adopt) the domain under this provider.
          const row = await insertVerifiedDomain(name, saved.id)
          // Operator-trusted DNS bypass: the operator who owns the config
          // file is the authority for the domains it declares, so mark
          // them verified WITHOUT the DNS TXT challenge. Skip if a prior
          // (e.g. UI-driven) verification already stamped it.
          if (!row.verifiedAt) {
            await stampVerifiedDomain({
              id: row.id,
              expectedToken: row.verificationToken,
              verifiedAt: new Date().toISOString(),
            })
          }
          if (domain.enforced !== undefined && domain.enforced !== row.enforced) {
            await setVerifiedDomainEnforced(row.id, domain.enforced)
          }
        }
      }
    },
  }
}
