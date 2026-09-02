import { describe, expect, it } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { settings } from '../auth'

/**
 * SQL names Drizzle emits on `settings` findFirst(). A missing column is a
 * throw, not a null — that is the new-mint 500
 * (`Failed to fetch settings with all configs`).
 *
 * When this list changes:
 * 1. Add an expand-only migration in `packages/db/drizzle`.
 * 2. Restage the control-plane vendor lineage
 *    (`quackback-cp/scripts/vendor-migrator.sh` from the fleet image digest).
 * 3. Update `REQUIRED_SETTINGS_COLUMNS` in
 *    `quackback-cp/src/lib/server/tenancy/tenant-schema.ts` so provision
 *    refuses a short schema instead of marking the workspace Ready.
 *
 * The serving image also migrates a behind-ledger workspace on first pool
 * checkout (`ensureWorkspaceSchemaCurrent`). That is what stops vendor lag
 * from 500ing a customer even if steps 2–3 are late.
 */
export const SETTINGS_SQL_COLUMNS = [
  'id',
  'name',
  'slug',
  'logo_key',
  'favicon_key',
  'header_logo_key',
  'portal_og_image_key',
  'created_at',
  'metadata',
  'auth_config',
  'portal_config',
  'branding_config',
  'custom_css',
  'developer_config',
  'header_display_mode',
  'header_display_name',
  'setup_state',
  'assistant_config',
  'assistant_config_revision',
  'widget_config',
  'widget_secret',
  'widget_installed_first_seen_at',
  'widget_installed_last_seen_at',
  'widget_installed_origin_host',
  'widget_installed_sdk_version',
  'feature_flags',
  'spam_filter_config',
  'help_center_config',
  'tier_limits',
  'cloud',
  'cloud_revision',
  'cloud_identity',
  'cloud_identity_revision',
  'managed_field_paths',
  'state',
  'auth_config_version',
] as const

describe('settings columns the serving image queries', () => {
  it('matches the lock list (update this list AND re-vendor the CP when it fails)', () => {
    const names = Object.values(getTableColumns(settings)).map((c) => c.name)
    expect([...names].sort()).toEqual([...SETTINGS_SQL_COLUMNS].sort())
  })
})
