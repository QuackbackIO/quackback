/**
 * Business-hours service — CRUD for the calendars referenced by SLA policies.
 *
 * Permission gating is the caller's responsibility.
 */

import { db, eq, isNull, asc, businessHours, type BusinessHours } from '@/lib/server/db'
import type { BusinessHoursId } from '@quackback/ids'
import type { BusinessHoursWeek, BusinessHoursHoliday } from '@/lib/server/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isValidTimezone, validateSchedule, validateHolidays } from './business-hours.calc'
import {
  dispatchBusinessHoursCreated,
  dispatchBusinessHoursUpdated,
  dispatchBusinessHoursArchived,
  type EventActor,
} from '@/lib/server/events/dispatch'
import type { EventBusinessHoursRef } from '@/lib/server/events/types'
import { toIsoStringOrNull } from '@/lib/shared/utils/date'

const businessHoursActor: EventActor = { type: 'service', displayName: 'business-hours-system' }

function businessHoursRef(b: BusinessHours): EventBusinessHoursRef {
  return {
    id: b.id,
    name: b.name,
    timezone: b.timezone,
    archivedAt: toIsoStringOrNull(b.archivedAt),
  }
}

const NAME_MAX = 200

export interface CreateBusinessHoursInput {
  name: string
  timezone?: string
  schedule: BusinessHoursWeek
  holidays?: BusinessHoursHoliday[]
}

export interface UpdateBusinessHoursInput {
  name?: string
  timezone?: string
  schedule?: BusinessHoursWeek
  holidays?: BusinessHoursHoliday[]
}

function normalizeName(name: string): string {
  const trimmed = name?.trim()
  if (!trimmed) throw new ValidationError('BUSINESS_HOURS_NAME_REQUIRED', 'name is required')
  if (trimmed.length > NAME_MAX) {
    throw new ValidationError('BUSINESS_HOURS_NAME_TOO_LONG', `name exceeds ${NAME_MAX} chars`)
  }
  return trimmed
}

function validateInput(input: {
  timezone?: string
  schedule?: BusinessHoursWeek
  holidays?: BusinessHoursHoliday[]
}): void {
  if (input.timezone != null && !isValidTimezone(input.timezone)) {
    throw new ValidationError('BUSINESS_HOURS_TZ_INVALID', `invalid timezone: ${input.timezone}`)
  }
  if (input.schedule != null) {
    try {
      validateSchedule(input.schedule)
    } catch (err) {
      throw new ValidationError(
        'BUSINESS_HOURS_SCHEDULE_INVALID',
        err instanceof Error ? err.message : 'invalid schedule'
      )
    }
  }
  if (input.holidays != null) {
    try {
      validateHolidays(input.holidays)
    } catch (err) {
      throw new ValidationError(
        'BUSINESS_HOURS_HOLIDAYS_INVALID',
        err instanceof Error ? err.message : 'invalid holidays'
      )
    }
  }
}

export async function createBusinessHours(input: CreateBusinessHoursInput): Promise<BusinessHours> {
  const name = normalizeName(input.name)
  validateInput(input)

  const [created] = await db
    .insert(businessHours)
    .values({
      name,
      timezone: input.timezone ?? 'UTC',
      schedule: input.schedule,
      holidays: input.holidays ?? [],
    })
    .returning()
  void dispatchBusinessHoursCreated(businessHoursActor, businessHoursRef(created)).catch(() => {})
  return created
}

export async function updateBusinessHours(
  id: BusinessHoursId,
  input: UpdateBusinessHoursInput
): Promise<BusinessHours> {
  const existing = await getBusinessHours(id)
  if (!existing)
    throw new NotFoundError('BUSINESS_HOURS_NOT_FOUND', `business_hours ${id} not found`)
  if (existing.archivedAt) {
    throw new ConflictError('BUSINESS_HOURS_ARCHIVED', 'cannot update archived business hours')
  }
  validateInput(input)

  const patch: Partial<typeof existing> = {}
  if (input.name !== undefined) patch.name = normalizeName(input.name)
  if (input.timezone !== undefined) patch.timezone = input.timezone
  if (input.schedule !== undefined) patch.schedule = input.schedule
  if (input.holidays !== undefined) patch.holidays = input.holidays

  if (Object.keys(patch).length === 0) return existing

  const [updated] = await db
    .update(businessHours)
    .set(patch)
    .where(eq(businessHours.id, id))
    .returning()
  void dispatchBusinessHoursUpdated(
    businessHoursActor,
    businessHoursRef(updated),
    Object.keys(patch)
  ).catch(() => {})
  return updated
}

export async function archiveBusinessHours(id: BusinessHoursId): Promise<BusinessHours> {
  const [updated] = await db
    .update(businessHours)
    .set({ archivedAt: new Date() })
    .where(eq(businessHours.id, id))
    .returning()
  if (!updated)
    throw new NotFoundError('BUSINESS_HOURS_NOT_FOUND', `business_hours ${id} not found`)
  void dispatchBusinessHoursArchived(businessHoursActor, businessHoursRef(updated)).catch(() => {})
  return updated
}

export async function getBusinessHours(id: BusinessHoursId): Promise<BusinessHours | null> {
  const row = await db.query.businessHours.findFirst({ where: eq(businessHours.id, id) })
  return row ?? null
}

export async function listBusinessHours(
  opts: {
    includeArchived?: boolean
  } = {}
): Promise<BusinessHours[]> {
  const where = opts.includeArchived ? undefined : isNull(businessHours.archivedAt)
  return db.select().from(businessHours).where(where).orderBy(asc(businessHours.name))
}
