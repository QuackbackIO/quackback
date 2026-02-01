/**
 * Catalog Database Exports
 *
 * Provides access to the catalog database for tenant resolution and feature gating.
 * The catalog database is managed by the website codebase (quackback.io).
 *
 * Quackback only needs read access to:
 * - workspace: Tenant resolution
 * - workspaceDomain: Domain routing
 * - subscription: Feature gating
 */
export {
  workspace,
  workspaceDomain,
  subscription,
  workspaceRelations,
  workspaceDomainRelations,
  subscriptionRelations,
  catalogSchema,
} from './schema'

export { getCatalogDb, resetCatalogDb, type CatalogDb } from './catalog-db'
export { decryptConnectionString } from './crypto'
