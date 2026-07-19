/**
 * Office-hours schedule (support platform §4.6). ONE workspace schedule in v1:
 * weekly open windows in a timezone, resolved DST-safe at read. An empty
 * `intervals` array means 24/7 (the default), so a fresh workspace is always
 * open until an admin restricts it. Consumed by Messenger reply-expectations,
 * the workflows office-hours condition, Quinn handover copy, and SLA clocks.
 */
import { pgTable, text, jsonb, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault } from '@quackback/ids/drizzle'

/** A weekly open window. `day` is 0=Sunday..6=Saturday; `start`/`end` are 'HH:MM'
 *  local times in the schedule's timezone. A window with end <= start is ignored. */
export interface OfficeHoursInterval {
  day: number
  start: string
  end: string
}

/** A calendar date the schedule is closed (support platform §4.6). `date` is
 *  'YYYY-MM-DD' in the schedule's timezone; `recurringAnnual` matches the
 *  month-day every year (fixed-date holidays), otherwise the exact date only. */
export interface OfficeHoursHoliday {
  date: string
  name?: string
  recurringAnnual?: boolean
}

export const officeHoursSchedules = pgTable(
  'office_hours_schedules',
  {
    id: typeIdWithDefault('office_hours')('id').primaryKey(),
    name: text('name').notNull().default('Default'),
    timezone: text('timezone').notNull().default('UTC'),
    intervals: jsonb('intervals')
      .$type<OfficeHoursInterval[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Calendar dates the schedule is closed (the clock engine skips them).
    holidays: jsonb('holidays')
      .$type<OfficeHoursHoliday[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The workspace has ONE schedule in v1: at most one row is the default.
    uniqueIndex('office_hours_one_default_uq')
      .on(table.isDefault)
      .where(sql`is_default = true`),
  ]
)

export type OfficeHoursSchedule = typeof officeHoursSchedules.$inferSelect
