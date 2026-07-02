/**
 * SLA + escalations schema — Phase 5 of the ticketing rollout.
 *
 * Six tables in one module to keep relations tight:
 *   - `business_hours`         IANA-tz weekly schedules + holidays
 *   - `sla_policies`           workspace/team/inbox-scoped policy header
 *   - `sla_targets`            per-policy {first_response, next_response, resolution} minutes
 *   - `ticket_sla_clocks`      per-ticket clocks (running/paused/met/breached)
 *   - `escalation_rules`       per-policy "fire N minutes before/after due"
 *   - `sla_escalation_log`     audit row per escalation firing
 *
 * Note: `tickets.slaPolicyId` was reserved as text in Phase 3; the migration
 * for this phase converts it to uuid + FK -> sla_policies(id) ON DELETE SET NULL.
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { teams } from './teams'
import { inboxes } from './inboxes'
import { tickets, TICKET_PRIORITIES } from './tickets'
import type { AuditJsonValue } from './audit-events'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SLA_TARGET_KINDS = ['first_response', 'next_response', 'resolution'] as const
export type SlaTargetKind = (typeof SLA_TARGET_KINDS)[number]

export const SLA_CLOCK_STATES = ['running', 'paused', 'met', 'breached', 'cancelled'] as const
export type SlaClockState = (typeof SLA_CLOCK_STATES)[number]

export const SLA_POLICY_SCOPES = ['workspace', 'team', 'inbox'] as const
export type SlaPolicyScope = (typeof SLA_POLICY_SCOPES)[number]

export const ESCALATION_RECIPIENT_TYPES = [
  'assignee',
  'team',
  'principals',
  'inbox_members',
] as const
export type EscalationRecipientType = (typeof ESCALATION_RECIPIENT_TYPES)[number]

export const ESCALATION_CHANNELS = ['in_app', 'email', 'webhook'] as const
export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number]

// ---------------------------------------------------------------------------
// Business-hours JSON shapes
// ---------------------------------------------------------------------------

/**
 * `{ start, end }` are 24h "HH:MM" strings (local to the calendar's timezone).
 * Multiple ranges per day allow a lunch break (e.g. 09:00–12:00 + 13:00–17:00).
 */
export interface BusinessHoursRange {
  start: string
  end: string
}

export interface BusinessHoursWeek {
  mon: BusinessHoursRange[]
  tue: BusinessHoursRange[]
  wed: BusinessHoursRange[]
  thu: BusinessHoursRange[]
  fri: BusinessHoursRange[]
  sat: BusinessHoursRange[]
  sun: BusinessHoursRange[]
}

export interface BusinessHoursHoliday {
  /** ISO date `YYYY-MM-DD` interpreted in the calendar's timezone. */
  date: string
  label?: string
}

// ---------------------------------------------------------------------------
// business_hours
// ---------------------------------------------------------------------------

export const businessHours = pgTable(
  'business_hours',
  {
    id: typeIdWithDefault('bizhrs')('id').primaryKey(),
    name: text('name').notNull(),
    /** IANA timezone e.g. 'America/New_York'. Default 'UTC'. */
    timezone: text('timezone').notNull().default('UTC'),
    /** Per-weekday range arrays. `[]` for a day means closed. */
    schedule: jsonb('schedule').$type<BusinessHoursWeek>().notNull(),
    /** Holiday dates (closed all-day). */
    holidays: jsonb('holidays').$type<BusinessHoursHoliday[]>().notNull().default([]),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('business_hours_archived_at_idx').on(t.archivedAt),
    uniqueIndex('business_hours_active_name_idx')
      .on(sql`lower(${t.name})`)
      .where(sql`archived_at IS NULL`),
  ]
)

// ---------------------------------------------------------------------------
// sla_policies
// ---------------------------------------------------------------------------

export const slaPolicies = pgTable(
  'sla_policies',
  {
    id: typeIdWithDefault('sla_pol')('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    /** Lower priority value runs first when multiple match. */
    priority: integer('priority').notNull().default(100),
    enabled: boolean('enabled').notNull().default(true),
    scope: text('scope', { enum: SLA_POLICY_SCOPES }).notNull(),
    scopeTeamId: typeIdColumnNullable('team')('scope_team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    scopeInboxId: typeIdColumnNullable('inbox')('scope_inbox_id').references(() => inboxes.id, {
      onDelete: 'set null',
    }),
    /** Empty array = applies to any priority. */
    appliesToPriorities: text('applies_to_priorities', { enum: TICKET_PRIORITIES })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** NULL = 24/7 (no business-hours math). */
    businessHoursId: typeIdColumnNullable('bizhrs')('business_hours_id').references(
      () => businessHours.id,
      { onDelete: 'set null' }
    ),
    pauseOnPending: boolean('pause_on_pending').notNull().default(true),
    pauseOnOnHold: boolean('pause_on_on_hold').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('sla_policies_enabled_priority_idx').on(t.enabled, t.priority),
    index('sla_policies_scope_team_idx').on(t.scopeTeamId),
    index('sla_policies_scope_inbox_idx').on(t.scopeInboxId),
    index('sla_policies_archived_at_idx').on(t.archivedAt),
    check(
      'sla_policies_scope_team_required',
      sql`(scope <> 'team') OR (scope_team_id IS NOT NULL)`
    ),
    check(
      'sla_policies_scope_inbox_required',
      sql`(scope <> 'inbox') OR (scope_inbox_id IS NOT NULL)`
    ),
    check(
      'sla_policies_workspace_no_scope',
      sql`(scope <> 'workspace') OR (scope_team_id IS NULL AND scope_inbox_id IS NULL)`
    ),
  ]
)

// ---------------------------------------------------------------------------
// sla_targets
// ---------------------------------------------------------------------------

export const slaTargets = pgTable(
  'sla_targets',
  {
    id: typeIdWithDefault('sla_tgt')('id').primaryKey(),
    policyId: typeIdColumn('sla_pol')('policy_id')
      .notNull()
      .references(() => slaPolicies.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SLA_TARGET_KINDS }).notNull(),
    minutes: integer('minutes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('sla_targets_policy_kind_idx').on(t.policyId, t.kind),
    index('sla_targets_policy_idx').on(t.policyId),
    check('sla_targets_minutes_positive', sql`minutes > 0`),
  ]
)

// ---------------------------------------------------------------------------
// ticket_sla_clocks
// ---------------------------------------------------------------------------

export const ticketSlaClocks = pgTable(
  'ticket_sla_clocks',
  {
    id: typeIdWithDefault('sla_clk')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    policyId: typeIdColumnNullable('sla_pol')('policy_id').references(() => slaPolicies.id, {
      onDelete: 'set null',
    }),
    targetId: typeIdColumnNullable('sla_tgt')('target_id').references(() => slaTargets.id, {
      onDelete: 'set null',
    }),
    kind: text('kind', { enum: SLA_TARGET_KINDS }).notNull(),
    state: text('state', { enum: SLA_CLOCK_STATES }).notNull().default('running'),
    /** Original target duration captured at clock-creation time. */
    targetMinutes: integer('target_minutes').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    /** Cumulative ms spent paused across all pause/resume cycles. */
    accumulatedPausedMs: bigint('accumulated_paused_ms', { mode: 'number' }).notNull().default(0),
    breachedAt: timestamp('breached_at', { withTimezone: true }),
    metAt: timestamp('met_at', { withTimezone: true }),
    /** Anti-spam anchor for escalations. */
    lastEscalatedAt: timestamp('last_escalated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('ticket_sla_clocks_ticket_idx').on(t.ticketId),
    index('ticket_sla_clocks_policy_idx').on(t.policyId),
    index('ticket_sla_clocks_state_due_idx').on(t.state, t.dueAt),
    uniqueIndex('ticket_sla_clocks_active_kind_idx')
      .on(t.ticketId, t.kind)
      .where(sql`state IN ('running', 'paused')`),
  ]
)

// ---------------------------------------------------------------------------
// escalation_rules
// ---------------------------------------------------------------------------

export const escalationRules = pgTable(
  'escalation_rules',
  {
    id: typeIdWithDefault('esc_rule')('id').primaryKey(),
    policyId: typeIdColumn('sla_pol')('policy_id')
      .notNull()
      .references(() => slaPolicies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Positive = N minutes before due; 0 = at-breach; negative = after-breach reminder. */
    leadMinutes: integer('lead_minutes').notNull(),
    targetKind: text('target_kind', { enum: SLA_TARGET_KINDS }).notNull(),
    recipientType: text('recipient_type', { enum: ESCALATION_RECIPIENT_TYPES }).notNull(),
    recipientTeamId: typeIdColumnNullable('team')('recipient_team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    /** Stable principal IDs (text array; we don't FK into principal here). */
    recipientPrincipalIds: text('recipient_principal_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    channels: text('channels', { enum: ESCALATION_CHANNELS })
      .array()
      .notNull()
      .default(sql`'{in_app}'::text[]`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('escalation_rules_policy_lead_idx').on(t.policyId, t.leadMinutes),
    index('escalation_rules_enabled_kind_idx').on(t.enabled, t.targetKind),
    check(
      'escalation_rules_team_required',
      sql`(recipient_type <> 'team') OR (recipient_team_id IS NOT NULL)`
    ),
    check(
      'escalation_rules_principals_required',
      sql`(recipient_type <> 'principals') OR (array_length(recipient_principal_ids, 1) >= 1)`
    ),
  ]
)

// ---------------------------------------------------------------------------
// sla_escalation_log
// ---------------------------------------------------------------------------

export const slaEscalationLog = pgTable(
  'sla_escalation_log',
  {
    id: typeIdWithDefault('esc_log')('id').primaryKey(),
    clockId: typeIdColumn('sla_clk')('clock_id')
      .notNull()
      .references(() => ticketSlaClocks.id, { onDelete: 'cascade' }),
    ruleId: typeIdColumnNullable('esc_rule')('rule_id').references(() => escalationRules.id, {
      onDelete: 'set null',
    }),
    firedAt: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
    recipientPrincipalIds: text('recipient_principal_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    channels: text('channels', { enum: ESCALATION_CHANNELS })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    context: jsonb('context').$type<{ [k: string]: AuditJsonValue }>(),
  },
  (t) => [
    index('sla_escalation_log_clock_fired_idx').on(t.clockId, t.firedAt),
    index('sla_escalation_log_rule_idx').on(t.ruleId),
  ]
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const businessHoursRelations = relations(businessHours, ({ many }) => ({
  policies: many(slaPolicies),
}))

export const slaPoliciesRelations = relations(slaPolicies, ({ one, many }) => ({
  scopeTeam: one(teams, {
    fields: [slaPolicies.scopeTeamId],
    references: [teams.id],
  }),
  scopeInbox: one(inboxes, {
    fields: [slaPolicies.scopeInboxId],
    references: [inboxes.id],
  }),
  businessHours: one(businessHours, {
    fields: [slaPolicies.businessHoursId],
    references: [businessHours.id],
  }),
  targets: many(slaTargets),
  escalationRules: many(escalationRules),
  clocks: many(ticketSlaClocks),
}))

export const slaTargetsRelations = relations(slaTargets, ({ one, many }) => ({
  policy: one(slaPolicies, {
    fields: [slaTargets.policyId],
    references: [slaPolicies.id],
  }),
  clocks: many(ticketSlaClocks),
}))

export const ticketSlaClocksRelations = relations(ticketSlaClocks, ({ one, many }) => ({
  ticket: one(tickets, {
    fields: [ticketSlaClocks.ticketId],
    references: [tickets.id],
  }),
  policy: one(slaPolicies, {
    fields: [ticketSlaClocks.policyId],
    references: [slaPolicies.id],
  }),
  target: one(slaTargets, {
    fields: [ticketSlaClocks.targetId],
    references: [slaTargets.id],
  }),
  escalationLogs: many(slaEscalationLog),
}))

export const escalationRulesRelations = relations(escalationRules, ({ one, many }) => ({
  policy: one(slaPolicies, {
    fields: [escalationRules.policyId],
    references: [slaPolicies.id],
  }),
  recipientTeam: one(teams, {
    fields: [escalationRules.recipientTeamId],
    references: [teams.id],
  }),
  logs: many(slaEscalationLog),
}))

export const slaEscalationLogRelations = relations(slaEscalationLog, ({ one }) => ({
  clock: one(ticketSlaClocks, {
    fields: [slaEscalationLog.clockId],
    references: [ticketSlaClocks.id],
  }),
  rule: one(escalationRules, {
    fields: [slaEscalationLog.ruleId],
    references: [escalationRules.id],
  }),
}))
