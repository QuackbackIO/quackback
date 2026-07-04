/**
 * SLA policy CRUD (support platform §4.6). Named, reusable policies managed under
 * Settings -> Support; a policy is APPLIED to a conversation only via the Apply-SLA
 * workflow action (a later slice), never matched ambiently. Pure CRUD, no gate
 * here — the settings fn layer gates on `sla.manage`. The clock math + lazy breach
 * evaluation that read these live in the Apply-SLA slice.
 */
import { db, eq, and, isNull, desc, slaPolicies, type SlaPolicy } from '@/lib/server/db'
import type { SlaPolicyId, OfficeHoursId } from '@quackback/ids'

export interface SlaPolicyInput {
  name: string
  firstResponseTargetSecs?: number | null
  nextResponseTargetSecs?: number | null
  timeToCloseTargetSecs?: number | null
  pauseOnSnooze?: boolean
  officeHoursScheduleId?: OfficeHoursId | null
}

export async function createSlaPolicy(input: SlaPolicyInput): Promise<SlaPolicy> {
  const [row] = await db
    .insert(slaPolicies)
    .values({
      name: input.name.trim(),
      firstResponseTargetSecs: input.firstResponseTargetSecs ?? null,
      nextResponseTargetSecs: input.nextResponseTargetSecs ?? null,
      timeToCloseTargetSecs: input.timeToCloseTargetSecs ?? null,
      pauseOnSnooze: input.pauseOnSnooze ?? true,
      officeHoursScheduleId: input.officeHoursScheduleId ?? null,
    })
    .returning()
  return row
}

export async function listSlaPolicies(): Promise<SlaPolicy[]> {
  return db
    .select()
    .from(slaPolicies)
    .where(isNull(slaPolicies.deletedAt))
    .orderBy(desc(slaPolicies.createdAt))
}

export async function getSlaPolicy(id: SlaPolicyId): Promise<SlaPolicy | null> {
  const [row] = await db
    .select()
    .from(slaPolicies)
    .where(and(eq(slaPolicies.id, id), isNull(slaPolicies.deletedAt)))
    .limit(1)
  return row ?? null
}

export async function updateSlaPolicy(
  id: SlaPolicyId,
  patch: Partial<SlaPolicyInput>
): Promise<SlaPolicy> {
  const [row] = await db
    .update(slaPolicies)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.firstResponseTargetSecs !== undefined
        ? { firstResponseTargetSecs: patch.firstResponseTargetSecs }
        : {}),
      ...(patch.nextResponseTargetSecs !== undefined
        ? { nextResponseTargetSecs: patch.nextResponseTargetSecs }
        : {}),
      ...(patch.timeToCloseTargetSecs !== undefined
        ? { timeToCloseTargetSecs: patch.timeToCloseTargetSecs }
        : {}),
      ...(patch.pauseOnSnooze !== undefined ? { pauseOnSnooze: patch.pauseOnSnooze } : {}),
      ...(patch.officeHoursScheduleId !== undefined
        ? { officeHoursScheduleId: patch.officeHoursScheduleId }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(slaPolicies.id, id), isNull(slaPolicies.deletedAt)))
    .returning()
  return row
}

/** Soft-delete: sla_events reference the policy with ON DELETE restrict, so its
 *  history is preserved (a hard delete would be blocked once applied). */
export async function softDeleteSlaPolicy(id: SlaPolicyId): Promise<void> {
  const now = new Date()
  await db
    .update(slaPolicies)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(slaPolicies.id, id), isNull(slaPolicies.deletedAt)))
}
