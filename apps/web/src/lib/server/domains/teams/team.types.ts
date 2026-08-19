/**
 * Input/output types for the teams domain (support platform §4.12).
 */
import { teams } from '@/lib/server/db'
import type { TeamAssignmentMethod } from '@/lib/shared/db-types'

export type { TeamId, TeamMemberId, PrincipalId } from '@quackback/ids'

/** A team row, inferred from the schema. */
export type Team = typeof teams.$inferSelect

export interface CreateTeamInput {
  name: string
  icon?: string | null
  color?: string | null
  description?: string | null
  assignmentMethod?: TeamAssignmentMethod
}

export interface UpdateTeamInput {
  name?: string
  icon?: string | null
  color?: string | null
  description?: string | null
  assignmentMethod?: TeamAssignmentMethod
}

/** A team plus the number of members, for the settings list + inbox sidebar. */
export interface TeamWithMemberCount extends Team {
  memberCount: number
}

/** A member of a team, joined to the display fields the picker needs. */
export interface TeamMemberSummary {
  principalId: string
  name: string | null
  email: string | null
}
