/**
 * Canonical authored guidance and its separately authorized role bindings.
 *
 * One entry holds the authored text once, at full length, whatever it was
 * written as: a writing guideline, a situational rule or a packaged procedure.
 * A binding says which profile applies it. A shared entry is therefore two
 * bindings over one body, never a third "both" role and never a second copy of
 * the text, which is what makes deduplicated prompt inclusion possible at all.
 *
 * `legacySource`/`legacyId` are the migration's own identity: the unique index
 * over them is what makes converting the legacy tables idempotent, so the
 * conversion can run lazily on first read and race with itself safely.
 */
import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

/** How an entry applies. `procedure` is loaded on demand, the other two ride the prompt. */
export const GUIDANCE_ENTRY_KINDS = ['always', 'situational', 'procedure'] as const
export type GuidanceEntryKind = (typeof GUIDANCE_ENTRY_KINDS)[number]

/**
 * Who owns the text.
 *
 * `canonical` entries are authored here and this table is their only store.
 * `config` entries are a lossless projection of the versioned assistant config
 * (the agent's writing guidelines and the code-managed workspace instructions):
 * the config stays their owner, their edits go through the config write funnel
 * with its revision and managed-field checks, and the runtime keeps reading the
 * config for them, so projecting them here cannot inject the same text twice.
 */
export const GUIDANCE_ENTRY_OWNERS = ['canonical', 'config'] as const
export type GuidanceEntryOwner = (typeof GUIDANCE_ENTRY_OWNERS)[number]

/** The legacy record an entry was converted from, or null for one authored here. */
export const GUIDANCE_LEGACY_SOURCES = ['voice', 'managed', 'rule', 'skill'] as const
export type GuidanceLegacySource = (typeof GUIDANCE_LEGACY_SOURCES)[number]

export const assistantGuidanceEntries = pgTable(
  'assistant_guidance_entries',
  {
    id: typeIdWithDefault('guidance_entry')('id').primaryKey(),
    kind: text('kind').$type<GuidanceEntryKind>().notNull(),
    owner: text('owner').$type<GuidanceEntryOwner>().notNull().default('canonical'),
    title: text('title').notNull(),
    /** The authored instruction at full length. Never truncated by a migration. */
    body: text('body').notNull(),
    /** The situation, or a procedure's when-to-use line. Null exactly for `always`. */
    appliesWhen: text('applies_when'),
    enabled: boolean('enabled').notNull().default(true),
    /** Lower values apply first, carried over from the legacy rule ordering. */
    priority: integer('priority').notNull().default(0),
    /** Bumped by every canonical write; a save carrying an older value is refused. */
    version: integer('version').notNull().default(1),
    legacySource: text('legacy_source').$type<GuidanceLegacySource>(),
    legacyId: text('legacy_id'),
    // Nulled on the author's deletion — the entry outlives them.
    createdById: typeIdColumnNullable('principal')('created_by_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('assistant_guidance_entries_legacy_uidx')
      .on(table.legacySource, table.legacyId)
      .where(sql`${table.legacySource} IS NOT NULL`),
    index('assistant_guidance_entries_kind_idx').on(table.kind, table.enabled, table.priority),
    check(
      'assistant_guidance_entries_kind_check',
      sql`${table.kind} IN ('always', 'situational', 'procedure')`
    ),
    check('assistant_guidance_entries_owner_check', sql`${table.owner} IN ('canonical', 'config')`),
    check(
      'assistant_guidance_entries_title_length_check',
      sql`char_length(${table.title}) BETWEEN 1 AND 80`
    ),
    // Zero is legal: a workspace with empty writing guidelines still has the
    // entry, exactly as the editor has always shown it.
    check('assistant_guidance_entries_body_length_check', sql`char_length(${table.body}) <= 8000`),
    check(
      'assistant_guidance_entries_applies_when_check',
      sql`(${table.kind} = 'always' AND ${table.appliesWhen} IS NULL)
          OR (${table.kind} <> 'always' AND char_length(${table.appliesWhen}) BETWEEN 1 AND 1000)`
    ),
  ]
)

export const assistantGuidanceBindings = pgTable(
  'assistant_guidance_bindings',
  {
    id: typeIdWithDefault('guidance_binding')('id').primaryKey(),
    entryId: typeIdColumn('guidance_entry')('entry_id').notNull(),
    /** Exactly one existing profile. Two profiles are two rows. */
    profile: text('profile').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Named explicitly: the derived name would exceed PostgreSQL's 63-character
    // identifier limit and come back truncated, which reads as schema drift.
    foreignKey({
      name: 'assistant_guidance_bindings_entry_id_fk',
      columns: [table.entryId],
      foreignColumns: [assistantGuidanceEntries.id],
    }).onDelete('cascade'),
    uniqueIndex('assistant_guidance_bindings_entry_profile_uidx').on(table.entryId, table.profile),
    index('assistant_guidance_bindings_profile_idx').on(table.profile, table.enabled),
    check(
      'assistant_guidance_bindings_profile_check',
      sql`${table.profile} IN ('agent', 'copilot', 'workspace')`
    ),
  ]
)

export const assistantGuidanceEntriesRelations = relations(
  assistantGuidanceEntries,
  ({ one, many }) => ({
    createdBy: one(principal, {
      fields: [assistantGuidanceEntries.createdById],
      references: [principal.id],
    }),
    bindings: many(assistantGuidanceBindings),
  })
)

export const assistantGuidanceBindingsRelations = relations(
  assistantGuidanceBindings,
  ({ one }) => ({
    entry: one(assistantGuidanceEntries, {
      fields: [assistantGuidanceBindings.entryId],
      references: [assistantGuidanceEntries.id],
    }),
  })
)
