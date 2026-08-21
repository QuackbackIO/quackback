/**
 * Agent skills: CRUD plus the two read paths the runtime uses.
 *
 * compileSkillCatalogue — one line per enabled+assigned skill under a char cap.
 * getSkillBody — capped markdown, null when unassigned or disabled.
 */
import { and, eq, ne, sql } from 'drizzle-orm'
import { db as defaultDb, agentSkills } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { PrincipalId, SkillId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { validationError } from '@/lib/server/domains/assistant/validation-error'
import type { AssistantAgentKind as AgentKind } from '@/lib/shared/assistant/config'
import {
  skillInputSchema,
  SKILL_CATALOGUE_CHAR_BUDGET,
  SKILL_INSTRUCTIONS_MAX_LENGTH,
  type SkillCatalogueLine,
  type SkillDTO,
  type SkillInput,
} from '@/lib/shared/assistant/skills'

export type SkillRow = typeof agentSkills.$inferSelect

function invalidSkill(error: unknown): never {
  return validationError('skill', error)
}

export function toSkillDTO(row: SkillRow): SkillDTO {
  return {
    id: row.id,
    name: row.name,
    whenToUse: row.whenToUse,
    instructions: row.instructions,
    assignments: row.assignments,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listSkills(execDb: Executor = defaultDb): Promise<SkillRow[]> {
  return execDb.select().from(agentSkills).orderBy(agentSkills.createdAt)
}

export async function getSkill(
  id: SkillId,
  execDb: Executor = defaultDb
): Promise<SkillRow | null> {
  const [row] = await execDb.select().from(agentSkills).where(eq(agentSkills.id, id)).limit(1)
  return row ?? null
}

async function assertNameUnique(
  name: string,
  excludeId: SkillId | null,
  execDb: Executor
): Promise<void> {
  const folded = name.trim().toLowerCase()
  const [row] = await execDb
    .select({ id: agentSkills.id })
    .from(agentSkills)
    .where(
      excludeId
        ? and(sql`lower(${agentSkills.name}) = ${folded}`, ne(agentSkills.id, excludeId))
        : sql`lower(${agentSkills.name}) = ${folded}`
    )
    .limit(1)
  if (row) {
    throw new ValidationError(
      'SKILL_DUPLICATE_NAME',
      'Another skill already uses this name. Choose a distinct name.'
    )
  }
}

export async function createSkill(
  input: SkillInput & { createdByPrincipalId?: PrincipalId | null },
  execDb: Executor = defaultDb
): Promise<SkillRow> {
  const parsed = skillInputSchema.safeParse(input)
  if (!parsed.success) invalidSkill(parsed.error)
  await assertNameUnique(parsed.data.name, null, execDb)
  const [row] = await execDb
    .insert(agentSkills)
    .values({
      name: parsed.data.name,
      whenToUse: parsed.data.whenToUse,
      instructions: parsed.data.instructions,
      assignments: parsed.data.assignments,
      enabled: parsed.data.enabled,
      createdByPrincipalId: input.createdByPrincipalId ?? null,
    })
    .returning()

  return row
}

export async function updateSkill(
  id: SkillId,
  input: SkillInput,
  execDb: Executor = defaultDb
): Promise<SkillRow | null> {
  const parsed = skillInputSchema.safeParse(input)
  if (!parsed.success) invalidSkill(parsed.error)
  const existing = await getSkill(id, execDb)
  if (!existing) return null
  await assertNameUnique(parsed.data.name, id, execDb)
  const [row] = await execDb
    .update(agentSkills)
    .set({
      name: parsed.data.name,
      whenToUse: parsed.data.whenToUse,
      instructions: parsed.data.instructions,
      assignments: parsed.data.assignments,
      enabled: parsed.data.enabled,
      updatedAt: new Date(),
    })
    .where(eq(agentSkills.id, id))
    .returning()

  return row ?? null
}

export async function deleteSkill(id: SkillId, execDb: Executor = defaultDb): Promise<void> {
  await execDb.delete(agentSkills).where(eq(agentSkills.id, id))
}

export async function compileSkillCatalogue(
  agent: AgentKind,
  execDb: Executor = defaultDb,
  budget = SKILL_CATALOGUE_CHAR_BUDGET
): Promise<SkillCatalogueLine[]> {
  const rows = await execDb.select().from(agentSkills).where(eq(agentSkills.enabled, true))
  const assigned = rows.filter((row) => row.assignments[agent] === true)
  const lines: SkillCatalogueLine[] = []
  let used = 0
  for (const row of assigned) {
    const line = `${row.name}: ${row.whenToUse}`
    if (used + line.length + 1 > budget) break
    lines.push({ name: row.name, whenToUse: row.whenToUse })
    used += line.length + 1
  }
  return lines
}

export async function getSkillBody(
  name: string,
  agent: AgentKind,
  execDb: Executor = defaultDb
): Promise<string | null> {
  const rows = await execDb.select().from(agentSkills).where(eq(agentSkills.enabled, true))
  const row = rows.find(
    (candidate) =>
      candidate.name.trim().toLowerCase() === name.trim().toLowerCase() &&
      candidate.assignments[agent] === true
  )
  if (!row) return null
  return row.instructions.slice(0, SKILL_INSTRUCTIONS_MAX_LENGTH)
}

export async function countAssignedSkills(
  agent: AgentKind,
  execDb: Executor = defaultDb
): Promise<number> {
  const rows = await execDb.select().from(agentSkills).where(eq(agentSkills.enabled, true))
  return rows.filter((row) => row.assignments[agent] === true).length
}
