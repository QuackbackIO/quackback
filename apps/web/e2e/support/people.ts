/**
 * The people every support test can act as. Created once per database by
 * `e2e/scripts/seed-support-people.ts` (idempotent), signed in by minted
 * sessions (`e2e/scripts/mint-support-sessions.ts`), so the magic-link rate
 * limit never bites.
 *
 * Teams: "E2E Support" and "E2E Billing". Conversations a test assigns to a
 * team decide who can see them: the scoped teammate and the contributor see
 * only Billing (plus the unassigned queue); the admin and agent B see all.
 */
import { resolve } from 'node:path'
import { SUPPORT_RUN_DIR } from './env'

export const SUPPORT_TEAMS = {
  support: 'E2E Support',
  billing: 'E2E Billing',
} as const
export type SupportTeam = keyof typeof SUPPORT_TEAMS

/** Custom roles the suite creates (system roles exist in every workspace). */
export const SUPPORT_CUSTOM_ROLES = {
  e2e_scoped_agent: {
    name: 'E2E Scoped agent',
    description: 'Works its own teams only: no cross-team view',
    permissions: [
      'conversation.view',
      'conversation.reply',
      'conversation.note',
      'conversation.assign',
      'conversation.set_status',
      'conversation.set_tags',
      'ticket.view',
      'ticket.reply',
      'ticket.note',
      'ticket.assign',
      'ticket.set_status',
      'member.view',
      'people.view',
    ],
  },
  e2e_no_support: {
    name: 'E2E No support access',
    description: 'A teammate with no conversation or ticket permission',
    permissions: ['post.view_private', 'member.view'],
  },
} as const

export interface PersonDef {
  email: string
  name: string
  /** principal.role: admin | member (team) | user (customer). */
  principalRole: 'admin' | 'member' | 'user'
  /** Workspace-wide role key, or null for a customer. */
  roleKey: string | null
  teams: SupportTeam[]
}

export const SUPPORT_PEOPLE = {
  /** Sees and does everything. */
  admin: {
    email: 'e2e-support-admin@example.com',
    name: 'Ada Admin',
    principalRole: 'admin',
    roleKey: 'admin',
    teams: ['support', 'billing'],
  },
  /** A second agent with cross-team view, for live updates and routing. */
  agentB: {
    email: 'e2e-support-agent-b@example.com',
    name: 'Ben Agent',
    principalRole: 'member',
    roleKey: 'support_lead',
    teams: ['support'],
  },
  /** Custom role, team Billing only. */
  scoped: {
    email: 'e2e-support-scoped@example.com',
    name: 'Sam Scoped',
    principalRole: 'member',
    roleKey: 'e2e_scoped_agent',
    teams: ['billing'],
  },
  /** Built-in Contributor role, member of team Billing. */
  contributor: {
    email: 'e2e-support-contributor@example.com',
    name: 'Cora Contributor',
    principalRole: 'member',
    roleKey: 'contributor',
    teams: ['billing'],
  },
  /** A teammate with no support permission at all. */
  noAccess: {
    email: 'e2e-support-no-access@example.com',
    name: 'Nico Noaccess',
    principalRole: 'member',
    roleKey: 'e2e_no_support',
    teams: [],
  },
  /** An identified customer (portal and widget). */
  customer: {
    email: 'e2e-support-customer@example.com',
    name: 'Cass Customer',
    principalRole: 'user',
    roleKey: null,
    teams: [],
  },
} as const satisfies Record<string, PersonDef>

export type SupportPersonName = keyof typeof SUPPORT_PEOPLE

/** What the seed script reports for each person. */
export interface SeededPerson {
  name: SupportPersonName
  email: string
  displayName: string
  userId: string
  /** TypeID, e.g. principal_01h... */
  principalId: string
}

export interface SeededPeople {
  people: Record<SupportPersonName, SeededPerson>
  /** Team TypeIDs by key. */
  teams: Record<SupportTeam, string>
}

/** The file the setup project writes the seeded ids to. */
export const SEEDED_PEOPLE_FILE = resolve(SUPPORT_RUN_DIR, 'people.json')

/** Stored browser session for a person. */
export function personStatePath(name: SupportPersonName): string {
  return resolve(SUPPORT_RUN_DIR, `${name}.json`)
}
