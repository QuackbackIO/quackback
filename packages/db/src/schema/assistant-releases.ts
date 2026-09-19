/**
 * Quinn releases: draft, published and rollback records over effective
 * snapshots (QUINN-PRODUCT P7).
 *
 * A release points at an `assistant_effective_snapshots` row, which is
 * immutable and content-hashed. That is deliberate: a release must survive the
 * pruning any versioned-history table does, so it references frozen content
 * rather than the newest N retained versions of anything.
 *
 * The draft is derived, not authored. It is whatever the settings row resolves
 * to right now, so an edit re-points it at a new snapshot and its candidate
 * hash moves. Evidence recorded against the old hash stays on the row and reads
 * as stale, which is what makes "editing invalidates the previous gate
 * evidence" a property of the data rather than of a code path somebody has to
 * remember to call.
 *
 * History is append-only. Publication moves the draft to `published` and the
 * previous live release to `superseded`; a rollback inserts a NEW published
 * release carrying the restored snapshot and naming what it restored, so the
 * sequence reads forwards and release numbers never move.
 *
 * Authority is not in here. A release freezes configured behaviour; permission
 * revocation, connector enablement, per-source use switches and every live
 * visibility check run at their own boundaries and are never read from this
 * table.
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { assistantEffectiveSnapshots } from './assistant-runs'

/**
 * `draft` is the candidate derived from the current settings row, `published`
 * is what new runs select, `superseded` is everything a later publication or
 * rollback replaced. There is at most one of the first two at a time.
 */
export const ASSISTANT_RELEASE_STATUSES = ['draft', 'published', 'superseded'] as const
export type AssistantReleaseStatus = (typeof ASSISTANT_RELEASE_STATUSES)[number]

/** How the release came to exist: an ordinary reviewed save, or a rollback restoring an earlier one. */
export const ASSISTANT_RELEASE_ORIGINS = ['save', 'rollback'] as const
export type AssistantReleaseOrigin = (typeof ASSISTANT_RELEASE_ORIGINS)[number]

/** Which uses a candidate's changes reach, computed from the configuration diff. */
export interface AssistantReleaseScope {
  uses: string[]
  changedPaths: string[]
}

export const assistantReleases = pgTable(
  'assistant_releases',
  {
    id: typeIdWithDefault('assistant_release')('id').primaryKey(),
    /**
     * Allocated at publication, not at draft creation, so a rollback published
     * while a draft is open cannot end up numbered below it. Null is "not
     * published yet".
     */
    releaseNumber: integer('release_number'),
    status: text('status', { enum: ASSISTANT_RELEASE_STATUSES }).notNull().default('draft'),
    origin: text('origin', { enum: ASSISTANT_RELEASE_ORIGINS }).notNull().default('save'),
    snapshotId: typeIdColumn('assistant_snapshot')('snapshot_id').notNull(),
    /**
     * The snapshot's content hash, copied here so a check result can be bound
     * to the exact candidate it was run against without a join.
     */
    candidateHash: text('candidate_hash').notNull(),
    /**
     * The `settings.assistant_config_revision` the candidate was derived from.
     * Compared under the settings row lock at publication, so a save landing
     * between the review and the write cannot be published unreviewed.
     */
    configRevision: integer('config_revision').notNull().default(0),
    /** The reviewer's release note. Bounded by the caller. */
    note: text('note'),
    /** Affected-use summary of the diff against the release this one replaces. */
    scope: jsonb('scope').$type<AssistantReleaseScope>(),
    /**
     * History pointers within this table. Deliberately no foreign key: a
     * release row is never deleted, and a self-referencing constraint here
     * would buy nothing that the append-only discipline does not already give.
     */
    previousReleaseId: typeIdColumnNullable('assistant_release')('previous_release_id'),
    restoredFromId: typeIdColumnNullable('assistant_release')('restored_from_id'),
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id'),
    publishedByPrincipalId: typeIdColumnNullable('principal')('published_by_principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    // Named explicitly: drizzle's derived name for the snapshot key is 66
    // characters and PostgreSQL truncates identifiers at 63, which the drift
    // check reads as permanent drift.
    foreignKey({
      name: 'assistant_releases_snapshot_id_fkey',
      columns: [t.snapshotId],
      foreignColumns: [assistantEffectiveSnapshots.id],
    }),
    foreignKey({
      name: 'assistant_releases_created_by_fkey',
      columns: [t.createdByPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'assistant_releases_published_by_fkey',
      columns: [t.publishedByPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    check(
      'assistant_releases_status_check',
      sql`${t.status} IN ('draft', 'published', 'superseded')`
    ),
    check('assistant_releases_origin_check', sql`${t.origin} IN ('save', 'rollback')`),
    uniqueIndex('assistant_releases_number_uidx').on(t.releaseNumber),
    // One draft and one live release, enforced in PostgreSQL rather than by a
    // read-then-write that two publishers could both pass.
    uniqueIndex('assistant_releases_one_draft_uidx')
      .on(t.status)
      .where(sql`${t.status} = 'draft'`),
    uniqueIndex('assistant_releases_one_published_uidx')
      .on(t.status)
      .where(sql`${t.status} = 'published'`),
    index('assistant_releases_created_idx').on(t.createdAt),
  ]
)

export type AssistantRelease = typeof assistantReleases.$inferSelect

export const assistantReleasesRelations = relations(assistantReleases, ({ one }) => ({
  snapshot: one(assistantEffectiveSnapshots, {
    fields: [assistantReleases.snapshotId],
    references: [assistantEffectiveSnapshots.id],
  }),
}))

/**
 * Verdicts a check can carry.
 *
 * All six are spelled here even though the shipped runner only produces four,
 * because widening a CHECK constraint later needs a DROP/ADD pair that cannot
 * replay. `running` and `cancelled` belong to an asynchronous runner that does
 * not exist yet and are never written today.
 */
export const ASSISTANT_RELEASE_CHECK_STATUSES = [
  'running',
  'passed',
  'failed',
  'skipped',
  'inconclusive',
  'cancelled',
] as const
export type AssistantReleaseCheckStatus = (typeof ASSISTANT_RELEASE_CHECK_STATUSES)[number]

export const assistantReleaseChecks = pgTable(
  'assistant_release_checks',
  {
    id: typeIdWithDefault('assistant_release_check')('id').primaryKey(),
    releaseId: typeIdColumn('assistant_release')('release_id').notNull(),
    /** Catalogue key. Whether it is required is read from the catalogue, never frozen here. */
    checkKey: text('check_key').notNull(),
    status: text('status', { enum: ASSISTANT_RELEASE_CHECK_STATUSES }).notNull(),
    /**
     * The candidate hash this result was produced against. A row whose hash no
     * longer matches its release's candidate is stale evidence and blocks
     * publication exactly as a missing row does.
     */
    candidateHash: text('candidate_hash').notNull(),
    /** One line a reviewer reads. Bounded by the caller. */
    summary: text('summary'),
    /** Bounded structured result. Not a transcript. */
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    ranByPrincipalId: typeIdColumnNullable('principal')('ran_by_principal_id'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'assistant_release_checks_release_id_fkey',
      columns: [t.releaseId],
      foreignColumns: [assistantReleases.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assistant_release_checks_ran_by_fkey',
      columns: [t.ranByPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    check(
      'assistant_release_checks_status_check',
      sql`${t.status} IN ('running', 'passed', 'failed', 'skipped', 'inconclusive', 'cancelled')`
    ),
    uniqueIndex('assistant_release_checks_identity_uidx').on(t.releaseId, t.checkKey),
  ]
)

export type AssistantReleaseCheck = typeof assistantReleaseChecks.$inferSelect
