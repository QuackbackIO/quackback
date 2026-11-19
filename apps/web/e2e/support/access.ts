/**
 * Data for the team-access specs (access, access-nav, inbox-access,
 * realtime-scope): conversations and tickets placed on a team or a person,
 * and custom roles with exactly the permissions a journey names.
 *
 * Rows are written with SQL the way the app's create paths write them (see
 * e2e/scripts/seed-conversation.ts), so a test can set up "a conversation on
 * team B" in one statement. Anything a journey observes happening (a reply,
 * an assignment, a live frame) goes through the app instead.
 *
 * Assignees: when a teammate's last live stream closes while conversation
 * routing is on, the app frees their open conversations that have no public
 * agent reply (stream.ts, offline requeue). Only the serial routing specs turn
 * routing on, but a conversation seeded onto a shared person (admin, scoped,
 * ...) still gets `agentReply: true`, or is assigned to a test's own teammate.
 */
import { randomBytes } from 'node:crypto'
import { expect, type Locator, type Page } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb } from './db'

const uuidOf = (typeId: string) => toUuid(typeId as `conversation_${string}`)

export interface SeededConv {
  /** TypeID, conversation_... */
  id: string
  subject: string
  /** The two visitor messages, oldest first. */
  messages: [string, string]
  visitorPrincipalId: string
}

export interface SeedConvOptions {
  /** Unique text; the subject and messages start with it. */
  marker: string
  /** What this conversation is for, e.g. 'team B'. Becomes part of the subject. */
  label: string
  teamId?: string | null
  assigneeId?: string | null
  /** Add a public agent reply (from the assignee, or `replyFrom`). */
  agentReply?: boolean
  replyFrom?: string
  status?: 'open' | 'snoozed' | 'closed'
  /** An existing visitor principal (TypeID) instead of a fresh anonymous one. */
  visitorPrincipalId?: string
}

/** One open messenger conversation with two visitor messages. */
export async function seedConv(opts: SeedConvOptions): Promise<SeededConv> {
  const sql = supportDb()
  const subject = `${opts.marker} ${opts.label} ${randomBytes(2).toString('hex')}`
  const messages: [string, string] = [`${subject} first message`, `${subject} second message`]
  const visitorUuid = opts.visitorPrincipalId
    ? toUuid(opts.visitorPrincipalId as `principal_${string}`)
    : toUuid(generateId('principal'))
  const id = generateId('conversation')
  const uuid = toUuid(id)
  const team = opts.teamId ? toUuid(opts.teamId as `team_${string}`) : null
  const assignee = opts.assigneeId ? toUuid(opts.assigneeId as `principal_${string}`) : null

  await sql.begin(async (tx) => {
    if (!opts.visitorPrincipalId) {
      await tx`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
               VALUES (${visitorUuid}, NULL, 'user', 'anonymous', ${`Visitor ${subject}`}, NOW())`
    }
    await tx`INSERT INTO conversations
               (id, visitor_principal_id, status, channel, priority, subject,
                last_message_preview, last_message_at, created_at,
                assigned_team_id, assigned_agent_principal_id)
             VALUES (${uuid}, ${visitorUuid}, ${opts.status ?? 'open'}, 'messenger', 'none', ${subject},
                     ${messages[1]}, NOW(), NOW(), ${team}, ${assignee})`
    for (let i = 0; i < messages.length; i++) {
      await tx`INSERT INTO conversation_messages
                 (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
               VALUES (${toUuid(generateId('conversation_msg'))}, ${uuid}, ${visitorUuid}, 'visitor',
                       ${messages[i]}, false, NOW() - make_interval(secs => ${10 - i}))`
    }
    const replier = opts.replyFrom ?? opts.assigneeId
    if (opts.agentReply) {
      if (!replier) throw new Error('agentReply needs assigneeId or replyFrom')
      await tx`INSERT INTO conversation_messages
                 (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
               VALUES (${toUuid(generateId('conversation_msg'))}, ${uuid},
                       ${toUuid(replier as `principal_${string}`)}, 'agent',
                       ${`${subject} agent reply`}, false, NOW() - make_interval(secs => 5))`
    }
  })
  return { id, subject, messages, visitorPrincipalId: fromUuid('principal', visitorUuid) }
}

/**
 * Turn a workspace feature flag on in one statement. The shared
 * set-feature-flag script reads, edits and writes the whole flags object, so
 * two workers turning on different flags at once can lose one.
 */
export async function turnOnFlag(flag: string): Promise<void> {
  const sql = supportDb()
  await sql`UPDATE settings
            SET feature_flags = (COALESCE(NULLIF(feature_flags, ''), '{}')::jsonb
                                 || jsonb_build_object(${flag}::text, true))::text`
  await sql`DELETE FROM kv_store WHERE key = 'settings:workspace'`
}

/** The conversation row as the app stores it (for "row unchanged" checks). */
export async function convRow(id: string) {
  const [row] = await supportDb()`
    SELECT status, priority, assigned_team_id, assigned_agent_principal_id, subject,
           (SELECT count(*)::int FROM conversation_messages m WHERE m.conversation_id = c.id) AS message_count,
           (SELECT count(*)::int FROM conversation_tag_assignments t WHERE t.conversation_id = c.id) AS tag_count
    FROM conversations c WHERE id = ${uuidOf(id)}`
  return row
}

/** Move a conversation (SQL; the app sends no event). */
export async function placeConv(
  id: string,
  where: { teamId?: string | null; assigneeId?: string | null }
): Promise<void> {
  const sql = supportDb()
  if (where.teamId !== undefined) {
    await sql`UPDATE conversations
              SET assigned_team_id = ${where.teamId ? toUuid(where.teamId as `team_${string}`) : null}
              WHERE id = ${uuidOf(id)}`
  }
  if (where.assigneeId !== undefined) {
    await sql`UPDATE conversations
              SET assigned_agent_principal_id = ${where.assigneeId ? toUuid(where.assigneeId as `principal_${string}`) : null}
              WHERE id = ${uuidOf(id)}`
  }
}

/** A message id (TypeID) in a conversation, by its exact content. */
export async function messageId(conversationId: string, content: string): Promise<string> {
  const [row] = await supportDb()`
    SELECT id FROM conversation_messages
    WHERE conversation_id = ${uuidOf(conversationId)} AND content = ${content} LIMIT 1`
  if (!row) throw new Error(`No message "${content}"`)
  return fromUuid('conversation_msg', row.id as string)
}

export interface SeededTicket {
  id: string
  title: string
  number: number
}

/** A back-office ticket (no backing conversation) on a team or person. */
export async function seedTicket(opts: {
  marker: string
  label: string
  teamId?: string | null
  assigneeId?: string | null
  type?: 'back_office' | 'customer' | 'tracker'
}): Promise<SeededTicket> {
  const sql = supportDb()
  const title = `${opts.marker} ${opts.label} ${randomBytes(2).toString('hex')}`
  const id = generateId('ticket')
  const [status] = await sql`SELECT id FROM ticket_statuses WHERE category = 'open'
                             ORDER BY position NULLS LAST, created_at LIMIT 1`
  const [row] = await sql`
    INSERT INTO tickets (id, type, title, status_id, assignee_team_id, assignee_principal_id)
    VALUES (${toUuid(id)}, ${opts.type ?? 'back_office'}, ${title}, ${status.id as string},
            ${opts.teamId ? toUuid(opts.teamId as `team_${string}`) : null},
            ${opts.assigneeId ? toUuid(opts.assigneeId as `principal_${string}`) : null})
    RETURNING number`
  return { id, title, number: Number(row.number) }
}

/**
 * A custom role with exactly these permission keys, for this test only.
 * Returns its key (pass it to newTeammate({ roleKey })).
 */
export async function createRole(marker: string, permissions: readonly string[]): Promise<string> {
  const sql = supportDb()
  const key = `e2e_${randomBytes(5).toString('hex')}`
  const roleId = toUuid(generateId('role'))
  const perms = await sql`SELECT id, key FROM permissions WHERE key IN ${sql([...permissions])}`
  if (perms.length !== permissions.length) {
    const found = new Set(perms.map((p) => p.key as string))
    throw new Error(
      `Unknown permission keys: ${permissions.filter((p) => !found.has(p)).join(', ')}`
    )
  }
  await sql.begin(async (tx) => {
    await tx`INSERT INTO roles (id, key, name, description, is_system)
             VALUES (${roleId}, ${key}, ${`Role ${marker}`.slice(0, 60)}, 'Support e2e test role', false)`
    for (const perm of perms) {
      await tx`INSERT INTO role_permissions (id, role_id, permission_id)
               VALUES (${toUuid(generateId('role_perm'))}, ${roleId}, ${perm.id as string})`
    }
  })
  return key
}

/**
 * A conversation's row in the inbox list: a button whose name carries the
 * visitor's name (seedConv names the visitor after the subject), the
 * assignee and the last message preview.
 */
export function inboxRow(page: Page, conv: Pick<SeededConv, 'subject'>): Locator {
  return page.getByRole('button', { name: new RegExp(`Visitor ${escapeRegExp(conv.subject)}`) })
}

/** Click a conversation's row and wait for its thread to show. */
export async function openFromList(page: Page, conv: SeededConv): Promise<void> {
  await expect(async () => {
    await inboxRow(page, conv).click({ timeout: 5_000 })
    await expect(page.getByText(conv.messages[0]).first()).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Inbox-list read used by several journeys: the list ids a person gets for a search. */
export function inboxListQuery(search: string) {
  return { facet: 'all' as const, search, limit: 50 }
}

/** Item ids out of a listInboxItemsFn answer. */
export function listedIds(data: unknown): string[] {
  const items =
    (
      data as {
        items?: Array<{ conversation?: { id?: string }; ticket?: { id?: string } }>
      }
    )?.items ?? []
  return items.map((i) => i.conversation?.id ?? i.ticket?.id ?? '').filter(Boolean)
}
