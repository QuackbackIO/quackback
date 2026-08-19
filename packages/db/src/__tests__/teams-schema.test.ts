import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { teams, teamMembers } from '../schema/teams'
import { conversations } from '../schema/conversation'

describe('Teams schema (§4.12)', () => {
  it('table names', () => {
    expect(getTableName(teams)).toBe('teams')
    expect(getTableName(teamMembers)).toBe('team_members')
  })

  it('teams columns', () => {
    const cols = Object.keys(getTableColumns(teams))
    expect(cols.sort()).toEqual(
      [
        'id',
        'name',
        'icon',
        'color',
        'description',
        'isDefault',
        'assignmentMethod',
        'rrCursorPrincipalId',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ].sort()
    )
  })

  it('team_members columns', () => {
    const cols = Object.keys(getTableColumns(teamMembers))
    expect(cols.sort()).toEqual(['id', 'teamId', 'principalId', 'createdAt'].sort())
  })

  it('conversations gains the polymorphic team assignee column', () => {
    const cols = Object.keys(getTableColumns(conversations))
    expect(cols).toContain('assignedTeamId')
    // The agent assignee stays independent (no clearing rule between them).
    expect(cols).toContain('assignedAgentPrincipalId')
  })

  it('0145 migration pins the load-bearing constraints', () => {
    const sql = readFileSync(join(__dirname, '../../drizzle/0145_teams.sql'), 'utf8')
    // Membership dedupe (columns alphabetical to match introspection).
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "team_members_principal_team_uq" ON "team_members" \("principal_id", "team_id"\)/
    )
    // Cascades: a deleted team or principal tears down its memberships.
    expect(sql).toMatch(/team_members_team_id_fkey[\s\S]*?ON DELETE cascade/)
    expect(sql).toMatch(/team_members_principal_id_fkey[\s\S]*?ON DELETE cascade/)
    // Conversation team assignee is set-null on team delete + partial index.
    expect(sql).toMatch(/conversations_assigned_team_id_fkey[\s\S]*?ON DELETE set null/)
    expect(sql).toMatch(
      /CREATE INDEX "conversations_assigned_team_idx"[\s\S]*?WHERE assigned_team_id IS NOT NULL/
    )
    // RBAC team_id becomes a real FK to teams (retype from plain uuid).
    expect(sql).toMatch(
      /principal_role_assignments_team_id_teams_id_fk[\s\S]*?REFERENCES "teams"\("id"\) ON DELETE cascade/
    )
    // Exactly one default team is seeded.
    expect(sql).toMatch(
      /INSERT INTO "teams"[\s\S]*?VALUES \(gen_random_uuid\(\), 'Support', true, 'manual'\)/
    )
  })
})
