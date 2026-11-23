/**
 * Helpers for the integrations journeys (INT-I-*): a connected provider row
 * written the way `saveIntegration` writes one (active, connected now, with a
 * service principal and no tokens, so nothing ever calls the provider), post
 * links scoped exactly as `sync/identity.ts` scopes them, and signed inbound
 * webhook bodies.
 *
 * An integrations row is unique per provider, so each spec file owns one
 * provider and runs its tests in order.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { supportDb } from '../support/db'

/** `canonicalJson` from sync/identity.ts: sorted keys, array order kept. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function syncHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export interface SeededIntegration {
  /** TypeID, integration_... */
  id: string
  uuid: string
  type: string
  connectedAt: Date
  /** The integration's service principal (TypeID). */
  principalId: string
  config: Record<string, unknown>
}

/**
 * Replace any `type` row with a fresh active connection: new id, connected
 * now, a service principal, `config` as given and no secrets.
 */
export async function seedIntegration(
  type: string,
  config: Record<string, unknown>
): Promise<SeededIntegration> {
  const sql = supportDb()
  await sql`DELETE FROM integrations WHERE integration_type = ${type}`
  const principalUuid = toUuid(generateId('principal'))
  const name = `${type.charAt(0).toUpperCase()}${type.slice(1)} Integration`
  await sql`
    INSERT INTO principal (id, role, type, display_name, service_metadata, created_at)
    VALUES (${principalUuid}, 'member', 'service', ${name},
            ${sql.json({ kind: 'integration', integrationType: type })}, now())`
  const uuid = toUuid(generateId('integration'))
  // Millisecond precision, as the identity string round-trips through Date.
  const connectedAt = new Date(Math.floor(Date.now() / 1000) * 1000)
  await sql`
    INSERT INTO integrations (id, integration_type, status, config, connected_at, principal_id)
    VALUES (${uuid}, ${type}, 'active', ${sql.json(config as never)}, ${connectedAt}, ${principalUuid})`
  return {
    id: fromUuid('integration', uuid),
    uuid,
    type,
    connectedAt,
    principalId: fromUuid('principal', principalUuid),
    config,
  }
}

export async function removeIntegration(integration: SeededIntegration): Promise<void> {
  await supportDb()`DELETE FROM integrations WHERE id = ${integration.uuid}`
}

/**
 * The link scope `fanOutInboundStatus` matches: installation identity, then
 * the hash of the destination (the provider's scope keys from config, and the
 * channel/team the event names).
 */
export function linkScope(
  integration: SeededIntegration,
  channelId: string,
  scopeKeys: readonly string[]
): string {
  const scope: Record<string, unknown> = {}
  for (const key of scopeKeys) {
    const value = integration.config[key]
    if (typeof value === 'string') scope[key] = syncHash(value)
  }
  const destination = { scope, target: syncHash({ channelId }) }
  return `${integration.id}:${integration.connectedAt.toISOString()}:${syncHash(destination)}`
}

/** Link a post to a remote issue, as a tracker create would have. */
export async function linkPost(
  integration: SeededIntegration,
  postUuid: string,
  externalId: string,
  scope: string,
  displayId = 'ENG-1'
): Promise<string> {
  const id = randomUUID()
  await supportDb()`
    INSERT INTO post_external_links (id, post_id, integration_id, integration_type, external_id,
      external_url, external_display_id, status, sync_scope)
    VALUES (${id}, ${postUuid}, ${integration.uuid}, ${integration.type}, ${externalId},
      ${`https://tracker.example/issue/${displayId}`}, ${displayId}, 'active', ${scope})`
  return id
}

/** Linear's signature: hex HMAC-SHA256 of the raw body. */
export function linearSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/** GitHub's signature header value. */
export function githubSignature(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** A Linear "issue state changed" webhook body. */
export function linearStateChange(input: {
  issueId: string
  teamId: string
  state: string
  updatedAt?: Date
}): string {
  return JSON.stringify({
    type: 'Issue',
    action: 'update',
    data: {
      id: input.issueId,
      teamId: input.teamId,
      state: { name: input.state },
      updatedAt: (input.updatedAt ?? new Date()).toISOString(),
    },
    updatedFrom: { stateId: randomUUID() },
  })
}

/** The post status TypeID with this slug. */
export async function postStatusId(slug: string): Promise<{ id: string; uuid: string }> {
  const [row] = await supportDb()<{ id: string }[]>`
    SELECT id FROM post_statuses WHERE slug = ${slug} LIMIT 1`
  if (!row) throw new Error(`No post status ${slug}`)
  return { id: fromUuid('post_status', row.id), uuid: row.id }
}

/** A board and a post only this test uses; returns the post's uuid and TypeID. */
export async function createPost(
  marker: string,
  authorPrincipalId: string
): Promise<{ id: string; uuid: string }> {
  const sql = supportDb()
  const boardUuid = toUuid(generateId('board'))
  await sql`INSERT INTO boards (id, slug, name)
            VALUES (${boardUuid}, ${marker.toLowerCase().slice(0, 60)}, ${`Board ${marker}`})`
  const uuid = randomUUID()
  const { uuid: open } = await postStatusId('open')
  await sql`
    INSERT INTO posts (id, board_id, title, content, principal_id, status_id)
    VALUES (${uuid}, ${boardUuid}, ${`Post ${marker}`}, 'Linked to a tracker.',
            ${toUuid(authorPrincipalId as `principal_${string}`)}, ${open})`
  return { id: fromUuid('post', uuid), uuid }
}
