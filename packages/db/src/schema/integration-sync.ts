import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core'

/** Durable evidence, independent of job retention and of a deleted installation. */
export const integrationSyncOperations = pgTable(
  'integration_sync_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationKey: text('operation_key').notNull(),
    integrationId: text('integration_id').notNull(),
    installation: text('installation').notNull(),
    provider: text('provider').notNull(),
    direction: text('direction').notNull(),
    kind: text('kind').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    sourceRecordId: uuid('source_record_id'),
    sourceRevision: text('source_revision'),
    destination: jsonb('destination').$type<Record<string, unknown>>().notNull(),
    destinationKey: text('destination_key').notNull(),
    remoteId: text('remote_id'),
    state: text('state').notNull().default('queued'),
    version: integer('version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    /** Encrypted with a separate purpose; never returned to the browser. */
    payload: text('payload'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    errorCode: text('error_code'),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    requestedBy: text('requested_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('integration_sync_operation_key_idx').on(t.operationKey),
    index('integration_sync_history_idx').on(t.provider, t.createdAt, t.id),
    index('integration_sync_attention_idx').on(t.integrationId, t.installation, t.state),
    index('integration_sync_success_idx')
      .on(t.integrationId, t.installation, t.direction, t.finishedAt)
      .where(sql`${t.state} = 'succeeded'`),
    index('integration_sync_source_idx').on(t.sourceType, t.sourceId),
    index('integration_sync_source_record_idx').on(t.sourceType, t.sourceRecordId),
    // Serialize writes to the same remote object, even from different sources.
    uniqueIndex('integration_sync_remote_running_idx')
      .on(t.installation, t.destinationKey, t.remoteId)
      .where(sql`${t.state} = 'running' AND ${t.remoteId} IS NOT NULL`),
  ]
)

export const integrationSyncAttempts = pgTable(
  'integration_sync_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id').notNull(),
    number: integer('number').notNull(),
    token: uuid('token').notNull(),
    state: text('state').notNull(),
    errorCode: text('error_code'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.operationId],
      foreignColumns: [integrationSyncOperations.id],
      name: 'integration_sync_attempt_operation_fk',
    }).onDelete('cascade'),
    uniqueIndex('integration_sync_attempt_token_idx').on(t.token),
    index('integration_sync_attempt_operation_idx').on(t.operationId, t.number),
  ]
)

/** Recovery actions survive repeated requests and operation state changes. */
export const integrationSyncActions = pgTable(
  'integration_sync_actions',
  {
    id: uuid('id').primaryKey(),
    operationId: uuid('operation_id').notNull(),
    action: text('action').notNull(),
    principalId: text('principal_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.operationId],
      foreignColumns: [integrationSyncOperations.id],
      name: 'integration_sync_action_operation_fk',
    }).onDelete('cascade'),
  ]
)

/** Forward-only start boundary; initialized automatically by the schema migration. */
export const integrationSyncStart = pgTable('integration_sync_start', {
  id: integer('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
})
