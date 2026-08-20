/**
 * Optional direct database access.
 *
 * Three probe families cannot be exercised over HTTP alone and need a
 * connection to each workspace's database:
 *
 *  - P02, to read the magic-link token and sign-in OTP the server minted
 *    (they leave the process by email, never in a response body);
 *  - P07, to observe whether a background job's write landed in the right
 *    database;
 *  - P09, to read each workspace's assistant service-principal id and to check
 *    that no row in one workspace references the other's.
 *
 * Row ids are stored as native UUIDs and exposed to the application as TypeIDs
 * (`packages/ids/src/drizzle.ts`), so everything crossing this boundary is
 * converted explicitly. Raw SQL that forgets the conversion silently compares a
 * TypeID string against a uuid column and matches nothing — which in this suite
 * would look like healthy isolation.
 */

import postgres from 'postgres'
import { fromUuid, isTypeIdFormat, toUuid, type IdPrefix, type TypeId } from '@quackback/ids'
import type { WorkspaceDb, WorkspaceSlot } from './types'

/** Thrown when a workspace database cannot be reached or queried. */
export class DatabaseError extends Error {
  constructor(
    readonly workspace: WorkspaceSlot,
    message: string,
    readonly cause?: unknown
  ) {
    super(`[${workspace}] ${message}`)
    this.name = 'DatabaseError'
  }
}

export function createWorkspaceDb(slot: WorkspaceSlot, connectionString: string): WorkspaceDb {
  const sql = postgres(connectionString, {
    max: 2,
    idle_timeout: 10,
    connect_timeout: 15,
    onnotice: () => {},
  })

  return {
    slot,
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      try {
        const rows = await sql.unsafe(text, params as never[])
        return rows as unknown as T[]
      } catch (err) {
        throw new DatabaseError(slot, `query failed: ${text.trim().split('\n')[0]}`, err)
      }
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 })
    },
  }
}

/** Convert a uuid column value to its application-facing TypeID. */
export function typeId<P extends IdPrefix>(prefix: P, value: unknown): TypeId<P> | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return fromUuid(prefix, value)
  } catch {
    return null
  }
}

/**
 * Every textual form a marker can take inside the database.
 *
 * This is not a nicety. Entity ids are TypeIDs in the application and native
 * `uuid` columns in Postgres (`packages/ids/src/drizzle.ts`), so scanning a
 * database for the string `post_01j…` matches nothing — ever. A probe that
 * searched only the TypeID form would report a clean database no matter what
 * had leaked into it, which is precisely the failure mode this suite exists to
 * avoid. Both forms are always searched.
 */
export function markerSearchForms(value: string): string[] {
  const forms = new Set<string>([value])
  if (isTypeIdFormat(value)) {
    try {
      forms.add(toUuid(value))
    } catch {
      // Not convertible; the literal form is all there is.
    }
  }
  return [...forms]
}

/**
 * The canonical single-row selector for `settings`.
 *
 * `settings.helpers.ts` reads this table with no WHERE clause at all — the
 * database has always been the workspace boundary (SAAS-HOSTING-STACK.md §3), so
 * "first row by creation" is the whole workspace identity.
 */
export const SETTINGS_ROW_SQL = `
  SELECT id, slug, name, widget_secret, feature_flags, branding_config, custom_css,
         portal_config, widget_config, auth_config_version
  FROM settings
  ORDER BY created_at ASC
  LIMIT 1
`

/** The stored settings columns P06 derives a workspace's identity vocabulary from. */
export interface SettingsRow {
  id: string
  slug: string
  name: string
  widget_secret: string | null
  feature_flags: string | null
  branding_config: string | null
  custom_css: string | null
  portal_config: string | null
  widget_config: string | null
  auth_config_version: number | null
}

/** The assistant's service principal, keyed off its service-metadata discriminator. */
export const ASSISTANT_PRINCIPAL_SQL = `
  SELECT id
  FROM principal
  WHERE type = 'service'
    AND service_metadata->>'kind' = 'integration'
    AND service_metadata->>'integrationType' = 'assistant'
  ORDER BY created_at ASC
  LIMIT 1
`

/**
 * Live magic-link verification row for an address.
 *
 * Better-auth's magic-link plugin stores `{ identifier: <token>, value: '{"email":…}' }`,
 * so the token is the identifier and the address is inside the JSON blob. OTP
 * rows share the table under an `sign-in-otp-` identifier and are excluded.
 * (Same shape the e2e helper at `apps/web/e2e/scripts/get-magic-link-token.ts` reads.)
 */
export const MAGIC_LINK_TOKEN_SQL = `
  SELECT identifier, value, expires_at
  FROM verification
  WHERE value::text ILIKE $1
    AND identifier NOT LIKE 'sign-in-otp-%'
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1
`

/** Live sign-in OTP row; `value` is `<code>:<attempts>`. */
export const OTP_CODE_SQL = `
  SELECT value
  FROM verification
  WHERE identifier = $1
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1
`

export function magicLinkEmailPattern(email: string): string {
  return `%"email":"${email}"%`
}

export function otpIdentifier(email: string): string {
  return `sign-in-otp-${email}`
}
