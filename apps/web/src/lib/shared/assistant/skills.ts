/**
 * Agent skills — client-safe contract.
 *
 * A skill is a packaged procedure: name + a one-line when-to-use + a markdown
 * body. Skills carry no permission dial; they teach, they do not grant tools.
 */
import { z } from 'zod'

export const SKILL_NAME_MAX_LENGTH = 80
export const SKILL_WHEN_TO_USE_MAX_LENGTH = 240
export const SKILL_INSTRUCTIONS_MAX_LENGTH = 8_000
export const SKILL_CATALOGUE_CHAR_BUDGET = 2_000
export const SKILL_LOADS_PER_TURN = 3

export const skillAssignmentsSchema = z.object({
  agent: z.boolean(),
  copilot: z.boolean(),
})
export type SkillAssignments = z.infer<typeof skillAssignmentsSchema>

export const skillInputSchema = z.object({
  name: z.string().trim().min(1).max(SKILL_NAME_MAX_LENGTH),
  whenToUse: z.string().trim().min(1).max(SKILL_WHEN_TO_USE_MAX_LENGTH),
  instructions: z.string().trim().min(1).max(SKILL_INSTRUCTIONS_MAX_LENGTH),
  assignments: skillAssignmentsSchema.default({ agent: false, copilot: false }),
  enabled: z.boolean().default(true),
})
export type SkillInput = z.infer<typeof skillInputSchema>

export const skillUpdateInputSchema = skillInputSchema.extend({ id: z.string().min(1) })

export interface SkillDTO {
  id: string
  name: string
  whenToUse: string
  instructions: string
  assignments: SkillAssignments
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SkillCatalogueLine {
  name: string
  whenToUse: string
}
