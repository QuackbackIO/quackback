/**
 * Shared validation schemas for teams (REST + MCP).
 * Mirrors CreateTeamInput / UpdateTeamInput (domains/teams/team.service.ts).
 */
import { z } from 'zod'

export const TEAM_ROLES = ['lead', 'member'] as const

export const createTeamSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, 'lowercase alphanumeric/dashes, 1–64 chars'),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  shortLabel: z.string().max(40).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
})

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  shortLabel: z.string().max(40).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
})

export const addTeamMemberSchema = z.object({
  principalId: z.string().min(1),
  role: z.enum(TEAM_ROLES).optional(),
})

export type CreateTeamSchemaInput = z.infer<typeof createTeamSchema>
export type UpdateTeamSchemaInput = z.infer<typeof updateTeamSchema>
