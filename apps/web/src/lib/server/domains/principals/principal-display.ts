/**
 * Principal display resolution: name + avatar for a set of principal ids,
 * shared by every surface that renders "who" (the conversation inbox, tickets,
 * message streams). Lives in the principals domain because the avatar-precedence
 * rule is a principal concern, not a conversation one; the `ConversationAuthorDTO`
 * name is historical.
 */
import {
  and,
  apiKeys,
  db,
  eq,
  inArray,
  principal,
  sql,
  user,
  type ServiceMetadata,
} from '@/lib/server/db'
import { alias } from 'drizzle-orm/pg-core'
import { SINGLE_WORKSPACE_NAMESPACE } from '@/lib/server/workspaces/workspace-keyed'
import type { PrincipalId } from '@quackback/ids'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'
import { rememberTestOwner } from '@/lib/server/test-data'
import { supportContactName, supportTeamName } from '@/lib/shared/support-contact-name'
import { displayAssistantName } from '@/lib/shared/assistant/config'

/**
 * Display URL: the public URL of an uploaded key, else an OAuth/external URL.
 * An upload is the user's explicit choice (saveAvatarKeyFn sets the key
 * without clearing `image`; removing the avatar clears only the key), so it
 * must win over the provider picture — the same precedence as fetchUserAvatar
 * and the admin sidebar.
 *
 * User-row fields beat the principal mirror: `principal.avatar_*` drifts on
 * rows that pre-date syncPrincipalProfile being wired into every upload path.
 */
export function resolveUserAvatarUrl(opts: {
  userImage?: string | null
  userImageKey?: string | null
  principalAvatarUrl?: string | null
  principalAvatarKey?: string | null
}): string | null {
  return (
    getPublicUrlOrNull(opts.userImageKey) ??
    getPublicUrlOrNull(opts.principalAvatarKey) ??
    opts.userImage ??
    opts.principalAvatarUrl ??
    null
  )
}

type AuthorRow = {
  id: PrincipalId
  displayName: string | null
  accountName: string | null
  avatarUrl: string | null
  avatarKey: string | null
  userImage: string | null
  userImageKey: string | null
  serviceMetadata: ServiceMetadata | null
  /** Set by showPersonalKeysAsCreator when the row now shows the key's creator. */
  shownAsCreator?: boolean
}

/** The AI agent's service principal; the discriminator is set in assistant.principal.ts. */
function isAssistantPrincipal(metadata: ServiceMetadata | null): boolean {
  return metadata?.kind === 'integration' && metadata.integrationType === 'assistant'
}

/**
 * Whether the author shows as an API key rather than a person: a workspace
 * key, or a personal key that keeps its own name (made before the cutoff, or
 * with its creator gone). A personal key that shows its creator does not.
 */
function showsAsApiKey(row: AuthorRow): boolean {
  return row.serviceMetadata?.kind === 'api_key' && !row.shownAsCreator
}

/**
 * Public label, or the account name agents should see. The agent view also
 * marks an author that shows as an API key, so the team can tell its messages
 * from a teammate's. The public view never carries the mark.
 */
function authorFromRow(row: AuthorRow, preferAccountName: boolean): ConversationAuthorDTO {
  const publicName =
    isAssistantPrincipal(row.serviceMetadata) && row.displayName
      ? displayAssistantName(row.displayName)
      : (row.displayName ?? null)
  const author: ConversationAuthorDTO = {
    principalId: row.id,
    displayName: preferAccountName
      ? supportContactName({
          accountName: row.accountName,
          publicName,
          fallback: '',
        }) || null
      : publicName,
    avatarUrl: resolveUserAvatarUrl({
      userImage: row.userImage,
      userImageKey: row.userImageKey,
      principalAvatarUrl: row.avatarUrl,
      principalAvatarKey: row.avatarKey,
    }),
  }
  if (preferAccountName && showsAsApiKey(row)) author.viaApi = true
  return author
}

async function selectAuthorRows(
  ids: ReadonlyArray<PrincipalId | null | undefined>,
  opts?: { apiKeysOnly?: boolean }
): Promise<AuthorRow[]> {
  const unique = [...new Set(ids.filter((id): id is PrincipalId => !!id))]
  if (unique.length === 0) return []
  // Resolve the avatar from the linked user (the canonical source, like the
  // team-member list): the public URL of an uploaded avatar (stored only as an
  // S3 key), else an external image URL, falling back to the principal's synced
  // copy. principal.avatarUrl alone is not reliably kept in sync, so agents
  // whose avatar lives only on the user row would otherwise show initials.
  const rows = await db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      accountName: user.name,
      avatarUrl: principal.avatarUrl,
      avatarKey: principal.avatarKey,
      userImage: user.image,
      userImageKey: user.imageKey,
      testOwnerPrincipalId: principal.testOwnerPrincipalId,
      serviceMetadata: principal.serviceMetadata,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(
      opts?.apiKeysOnly
        ? and(inArray(principal.id, unique), sql`${principal.serviceMetadata}->>'kind' = 'api_key'`)
        : inArray(principal.id, unique)
    )
  // The same read answers whether each author is a test customer.
  for (const row of rows) rememberTestOwner(row)
  return showPersonalKeysAsCreator(rows)
}

/**
 * The kv key recording when this database reached the release that treats a
 * personal key's replies as its creator's. Written once by the migration
 * `0316_personal_key_reply_cutoff`, and read the same way by the shared reply
 * rule (`messages/reply-rule.ts`), so what a key's messages show and how they
 * count follow one rule.
 */
export const PERSONAL_KEY_CUTOFF_KV_KEY = 'api-keys:personal-reply-cutoff'

/**
 * A personal API key acts as the teammate who created it, so what it writes
 * shows that teammate's name and avatar rather than the key's own name. Only
 * the display fields change: the author's `principalId` stays the key's
 * service principal, which is what the message rows store and what the audit
 * trail and the reply-timing rules read.
 *
 * Only a personal key made at or after the cutoff above shows its creator.
 * Every key older than API key kinds was marked personal, and the bots built
 * on those keys keep their own name, just as their replies stay automated.
 * With no cutoff recorded, every key keeps its own name. A workspace key
 * belongs to nobody and keeps its own name, as does a personal key whose
 * creator was deleted. Costs one read, and only when a batch has an API key
 * author in it.
 */
async function showPersonalKeysAsCreator<T extends AuthorRow>(rows: T[]): Promise<T[]> {
  const keyIds = rows.filter((row) => row.serviceMetadata?.kind === 'api_key').map((row) => row.id)
  if (keyIds.length === 0) return rows
  const keyCreator = alias(principal, 'key_creator')
  const creators = await db
    .select({
      keyPrincipalId: apiKeys.principalId,
      displayName: keyCreator.displayName,
      accountName: user.name,
      avatarUrl: keyCreator.avatarUrl,
      avatarKey: keyCreator.avatarKey,
      userImage: user.image,
      userImageKey: user.imageKey,
    })
    .from(apiKeys)
    .innerJoin(keyCreator, eq(keyCreator.id, apiKeys.createdById))
    .leftJoin(user, eq(user.id, keyCreator.userId))
    .where(
      and(
        inArray(apiKeys.principalId, keyIds),
        eq(apiKeys.kind, 'personal'),
        // The migration writes the cutoff under the single-workspace namespace
        // in every database (each workspace has its own), so this is a
        // primary-key lookup. With no row the comparison is null: no key matches.
        sql`${apiKeys.createdAt} >= (select (value #>> '{}')::timestamptz from kv_store
          where workspace_key = ${SINGLE_WORKSPACE_NAMESPACE}
            and key = ${PERSONAL_KEY_CUTOFF_KV_KEY} and expires_at > now())`
      )
    )
  if (creators.length === 0) return rows
  const byKey = new Map(creators.map(({ keyPrincipalId, ...display }) => [keyPrincipalId, display]))
  return rows.map((row) => {
    const creator = byKey.get(row.id)
    return creator ? { ...row, ...creator, shownAsCreator: true } : row
  })
}

/**
 * What a customer sees for an author that shows as an API key (a workspace
 * key, or a personal key that keeps its own name): the support team's name,
 * the one the thread shows when no teammate is shown, never the key's own
 * name. Every other author reads as the public view.
 */
function customerAuthorFromRow(
  row: AuthorRow,
  teamName: string | null
): { author: ConversationAuthorDTO; shownAsTeam: boolean } {
  if (!showsAsApiKey(row)) return { author: authorFromRow(row, false), shownAsTeam: false }
  return {
    author: { principalId: row.id, displayName: teamName, avatarUrl: null },
    shownAsTeam: true,
  }
}

/** The support team's name, from the cached settings row. */
export async function getSupportTeamName(): Promise<string | null> {
  // Dynamic, like the other settings readers here: the settings helpers reach
  // back into much of the server.
  const { findSettingsCached, parseWidgetConfig } =
    await import('@/lib/server/domains/settings/settings.helpers')
  const row = await findSettingsCached()
  if (!row) return null
  return supportTeamName(parseWidgetConfig(row.widgetConfig).messenger?.teamName, row.name)
}

/** The support team's name, read only when a batch has an author that needs it. */
async function teamNameFor(rows: AuthorRow[]): Promise<string | null> {
  return rows.some(showsAsApiKey) ? getSupportTeamName() : null
}

/**
 * Batch-load principal display info, returning a lookup map.
 *
 * `preferAccountName` is for agent support surfaces (the inbox list, the
 * thread, ticket requesters). It shows the account name. Posts, comments,
 * and requester reads leave it off, so they keep the public display name.
 *
 * `forCustomer` is for what a customer reads in a support thread (the portal,
 * the widget, their emails): an author that shows as an API key takes the
 * support team's name instead of the key's. Webhooks leave it off, and
 * feedback reads use loadApiKeyFeedbackAuthors. It has no effect with
 * `preferAccountName`.
 */
export async function loadAuthors(
  ids: ReadonlyArray<PrincipalId | null | undefined>,
  opts?: { preferAccountName?: boolean; forCustomer?: boolean }
): Promise<Map<PrincipalId, ConversationAuthorDTO>> {
  const map = new Map<PrincipalId, ConversationAuthorDTO>()
  const rows = await selectAuthorRows(ids)
  if (opts?.preferAccountName !== true && opts?.forCustomer === true) {
    const teamName = await teamNameFor(rows)
    for (const row of rows) map.set(row.id, customerAuthorFromRow(row, teamName).author)
    return map
  }
  for (const row of rows) {
    map.set(row.id, authorFromRow(row, opts?.preferAccountName === true))
  }
  return map
}

/**
 * What a feedback reader sees for each author that is an API key: the portal
 * and widget post page, the public feedback lists, and the emails and bells
 * that link to them. A workspace key, or a personal key that keeps its own
 * name, shows as the support team with no avatar, the same rule support
 * messages follow. A personal key that shows its creator shows that
 * teammate's public name and avatar.
 *
 * Only API key authors are in the map. Every other author keeps the name the
 * caller already read, so a page with no key author costs one indexed lookup
 * and nothing more. Admin views leave this off and keep the key's own name.
 */
export async function loadApiKeyFeedbackAuthors(
  ids: ReadonlyArray<PrincipalId | null | undefined>
): Promise<Map<PrincipalId, ConversationAuthorDTO>> {
  const map = new Map<PrincipalId, ConversationAuthorDTO>()
  const rows = await selectAuthorRows(ids, { apiKeysOnly: true })
  if (rows.length === 0) return map
  const teamName = await teamNameFor(rows)
  for (const row of rows) map.set(row.id, customerAuthorFromRow(row, teamName).author)
  return map
}

/**
 * Every label from one read, so a send can fan each audience its own name:
 * `customerAuthor` for the customer's copy and email, `publicAuthor` for
 * events and webhooks, `supportAuthor` for the team. `shownAsTeam` says the
 * customer sees the support team's name rather than a person's.
 */
export interface AuthorAudiences {
  publicAuthor: ConversationAuthorDTO
  supportAuthor: ConversationAuthorDTO
  customerAuthor: ConversationAuthorDTO
  shownAsTeam: boolean
}

export async function loadAuthorAudiences(
  ids: ReadonlyArray<PrincipalId | null | undefined>
): Promise<Map<PrincipalId, AuthorAudiences>> {
  const map = new Map<PrincipalId, AuthorAudiences>()
  const rows = await selectAuthorRows(ids)
  const teamName = await teamNameFor(rows)
  for (const row of rows) {
    const customer = customerAuthorFromRow(row, teamName)
    map.set(row.id, {
      publicAuthor: authorFromRow(row, false),
      supportAuthor: authorFromRow(row, true),
      customerAuthor: customer.author,
      shownAsTeam: customer.shownAsTeam,
    })
  }
  return map
}

export function fallbackAuthor(principalId: PrincipalId): ConversationAuthorDTO {
  return { principalId, displayName: null, avatarUrl: null }
}
