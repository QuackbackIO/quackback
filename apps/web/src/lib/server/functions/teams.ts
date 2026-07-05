/**
 * Server functions for teams (the workspace org-unit; TEAMS-ORG-UNIT-SPEC).
 *
 * Reads (`listTeamsFn`) are gated on `member.view`: teams are internal-only
 * roster metadata backing the inbox sidebar and, later, board pickers, so the
 * roster/picker read permission is the right gate. Management
 * (create/update/delete/membership) is gated on `team.manage`, a workspace-admin
 * key. No new catalogue keys.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId, TeamId } from '@quackback/ids'
import type { ConversationId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { TEAM_ASSIGNMENT_METHODS } from '@/lib/shared/db-types'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import {
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  listTeamMembers,
  listAssignableTeammates,
  setTeamMembers,
  countTeamMembers,
  type Team,
} from '@/lib/server/domains/teams'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'teams' })

/**
 * The inbox-sidebar team shape (CONTRACT for the inbox agent). Kept intentionally
 * minimal: id, display fields, and a member count for the sidebar list.
 */
export interface TeamListItemDTO {
  id: string
  name: string
  icon: string | null
  color: string | null
  memberCount: number
}

/** The full team shape for the settings management surface. */
export interface TeamDTO {
  id: string
  name: string
  icon: string | null
  color: string | null
  description: string | null
  isDefault: boolean
  assignmentMethod: (typeof TEAM_ASSIGNMENT_METHODS)[number]
  memberCount: number
}

export interface TeamMemberDTO {
  principalId: string
  name: string | null
  email: string | null
}

function serializeListItem(team: Team & { memberCount: number }): TeamListItemDTO {
  return {
    id: team.id,
    name: team.name,
    icon: team.icon,
    color: team.color,
    memberCount: team.memberCount,
  }
}

function serializeTeam(team: Team & { memberCount: number }): TeamDTO {
  return {
    id: team.id,
    name: team.name,
    icon: team.icon,
    color: team.color,
    description: team.description,
    isDefault: team.isDefault,
    assignmentMethod: team.assignmentMethod,
    memberCount: team.memberCount,
  }
}

const teamInputSchema = z.object({
  name: z.string().min(1).max(120),
  icon: z.string().max(16).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  assignmentMethod: z.enum(TEAM_ASSIGNMENT_METHODS).optional(),
})

const updateTeamSchema = teamInputSchema.partial().extend({ id: z.string() })

/**
 * The team list for sidebars and pickers, with member counts.
 * CONTRACT: [{ id, name, icon, color, memberCount }].
 */
export const listTeamsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
  const teams = await listTeams()
  return teams.map(serializeListItem)
})

/** The settings management list: full team fields + member counts. */
export const listTeamsAdminFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.TEAM_MANAGE })
  const teams = await listTeams()
  return teams.map(serializeTeam)
})

/** The members of one team (for the edit dialog's current-membership set). */
export const listTeamMembersFn = createServerFn({ method: 'GET' })
  .validator(z.object({ teamId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TEAM_MANAGE })
    return (await listTeamMembers(data.teamId as TeamId)) as TeamMemberDTO[]
  })

/** All teammates, for the membership picker. */
export const listAssignableTeammatesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.TEAM_MANAGE })
  return (await listAssignableTeammates()) as TeamMemberDTO[]
})

export const createTeamFn = createServerFn({ method: 'POST' })
  .validator(teamInputSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TEAM_MANAGE })
    log.info({ name: data.name }, 'create team')
    const team = await createTeam(data)
    return serializeTeam({ ...team, memberCount: 0 })
  })

export const updateTeamFn = createServerFn({ method: 'POST' })
  .validator(updateTeamSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TEAM_MANAGE })
    const { id, ...input } = data
    log.info({ team_id: id }, 'update team')
    const team = await updateTeam(id as TeamId, input)
    const memberCount = await countTeamMembers(team.id as TeamId)
    return serializeTeam({ ...team, memberCount })
  })

export const deleteTeamFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TEAM_MANAGE })
    log.info({ team_id: data.id }, 'delete team')
    await deleteTeam(data.id as TeamId)
    return { id: data.id }
  })

/** Replace a team's membership set with exactly `principalIds`. */
export const setTeamMembersFn = createServerFn({ method: 'POST' })
  .validator(z.object({ teamId: z.string(), principalIds: z.array(z.string()) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.TEAM_MANAGE })
    log.info({ team_id: data.teamId, count: data.principalIds.length }, 'set team members')
    await setTeamMembers(data.teamId as TeamId, data.principalIds as PrincipalId[])
    return { ok: true }
  })

/** Assign a conversation to a team (or clear with a null teamId). */
export const assignConversationTeamFn = createServerFn({ method: 'POST' })
  .validator(z.object({ conversationId: z.string(), teamId: z.string().nullable() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_ASSIGN })
    const actor = await policyActorFromAuth(ctx)
    const { assignTeam } = await import('@/lib/server/domains/conversation/conversation.service')
    const conversation = await assignTeam(
      data.conversationId as ConversationId,
      data.teamId as TeamId | null,
      actor
    )
    return { id: conversation.id, assignedTeamId: conversation.assignedTeamId ?? null }
  })
