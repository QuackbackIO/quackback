/**
 * Captures of brands' websites for the portal designer's brand match (see
 * 0316_site_captures.sql). `site_captures` keeps one row per host, the newest
 * capture or failure; `site_capture_calls` logs every call made to the
 * capture service, billed or not, and is what the usage limits count.
 */
import {
  pgTable,
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

export type SiteCaptureStatus = 'ok' | 'failed'

export const siteCaptures = pgTable(
  'site_captures',
  {
    // Lowercase, punycode, without a leading `www.`.
    host: text('host').primaryKey(),
    // The full URL that was fetched.
    url: text('url').notNull(),
    status: text('status').$type<SiteCaptureStatus>().notNull(),
    reason: text('reason'),
    // Storage key of the PNG; null on failure or when storage is not usable.
    imageKey: text('image_key'),
    width: integer('width'),
    height: integer('height'),
    facts: jsonb('facts').$type<unknown>(),
    assets: jsonb('assets').$type<unknown>(),
    // The request (without its keys) and the options it was made with.
    options: jsonb('options').$type<unknown>().notNull(),
    capturedByPrincipalId: typeIdColumnNullable('principal')('captured_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check('site_captures_status_check', sql`${table.status} IN ('ok', 'failed')`)]
)

export const siteCaptureCalls = pgTable(
  'site_capture_calls',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    host: text('host').notNull(),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    outcome: text('outcome').notNull(),
    billed: boolean('billed').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('site_capture_calls_created_at_idx').on(table.createdAt),
    index('site_capture_calls_principal_created_idx').on(table.principalId, table.createdAt),
    index('site_capture_calls_host_created_idx').on(table.host, table.createdAt),
  ]
)
