import { pgRole } from 'drizzle-orm/pg-core'

/**
 * Application role for RLS policies.
 *
 * This role is:
 * - Created automatically via Drizzle migrations (when entities.roles is enabled)
 * - Used by the application when executing queries
 * - Subject to RLS policies defined on tables
 *
 * The role is NOLOGIN (cannot connect directly) - the application
 * uses SET ROLE to assume this role after connecting as the main user.
 */
export const appUser = pgRole('app_user', {
  createRole: false,
  createDb: false,
  inherit: true,
})
