// Better-auth tables (for Drizzle relational queries and joins)
// These tables are managed by better-auth CLI, we define schema for type-safety
export * from './auth'

// Application schemas
export * from './boards'
export * from './statuses'
export * from './posts'
export * from './integrations'
export * from './changelog'
export * from './notifications'
export * from './sentiment'

// Note: Billing tables are NOT in the tenant database.
// Billing is managed in the catalog database (website codebase).
// See apps/web/src/lib/catalog/schema.ts for billing schema used by quackback.
// The billing.ts file is kept for migration compatibility but not exported.
