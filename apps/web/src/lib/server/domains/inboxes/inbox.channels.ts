/**
 * Inbox channels — provider-specific records under an inbox (portal/email/api/widget/webhook).
 * `config` is opaque per-kind; provider integrations are separate workstreams.
 */
import { db, eq, and, isNull, asc, inboxChannels, type InboxChannel } from '@/lib/server/db'
import type { InboxChannelKind, AuditJsonValue } from '@/lib/server/db'
import type { InboxId, InboxChannelId } from '@quackback/ids'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  dispatchInboxChannelCreated,
  dispatchInboxChannelUpdated,
  dispatchInboxChannelArchived,
  type EventActor,
} from '@/lib/server/events/dispatch'
import type { EventInboxChannelRef } from '@/lib/server/events/types'
import { toIsoStringOrNull } from '@/lib/shared/utils/date'

const LABEL_MAX = 200

const inboxChannelActor: EventActor = { type: 'service', displayName: 'inbox-channel-system' }

function inboxChannelRef(c: InboxChannel): EventInboxChannelRef {
  return {
    id: c.id,
    inboxId: c.inboxId,
    kind: c.kind,
    label: c.label,
    externalId: c.externalId ?? null,
    enabled: c.enabled,
    archivedAt: toIsoStringOrNull(c.archivedAt),
  }
}

export interface AddInboxChannelInput {
  inboxId: InboxId
  kind: InboxChannelKind
  label: string
  config?: { [k: string]: AuditJsonValue }
  externalId?: string | null
  enabled?: boolean
}

export async function addInboxChannel(input: AddInboxChannelInput): Promise<InboxChannel> {
  if (!input.inboxId) throw new ValidationError('INBOX_REQUIRED', 'inboxId required')
  const label = input.label?.trim()
  if (!label) throw new ValidationError('CHANNEL_LABEL_REQUIRED', 'label required')
  if (label.length > LABEL_MAX)
    throw new ValidationError('CHANNEL_LABEL_TOO_LONG', `label exceeds ${LABEL_MAX} chars`)

  if (input.externalId) {
    const dup = await db.query.inboxChannels.findFirst({
      where: and(
        eq(inboxChannels.kind, input.kind),
        eq(inboxChannels.externalId, input.externalId),
        isNull(inboxChannels.archivedAt)
      ),
    })
    if (dup)
      throw new ConflictError(
        'CHANNEL_EXTERNAL_ID_TAKEN',
        `Channel with externalId "${input.externalId}" already exists for kind ${input.kind}`
      )
  }

  const [created] = await db
    .insert(inboxChannels)
    .values({
      inboxId: input.inboxId,
      kind: input.kind,
      label,
      config: input.config ?? {},
      externalId: input.externalId ?? null,
      enabled: input.enabled ?? true,
    })
    .returning()
  void dispatchInboxChannelCreated(inboxChannelActor, inboxChannelRef(created)).catch(() => {})
  return created
}

export interface UpdateInboxChannelInput {
  label?: string
  config?: { [k: string]: AuditJsonValue }
  externalId?: string | null
  enabled?: boolean
}

export async function updateInboxChannel(
  channelId: InboxChannelId,
  input: UpdateInboxChannelInput
): Promise<InboxChannel> {
  const existing = await getInboxChannel(channelId)
  if (!existing) throw new NotFoundError('CHANNEL_NOT_FOUND', 'Channel not found')

  const patch: Partial<typeof inboxChannels.$inferInsert> = {}
  if (input.label !== undefined) {
    const label = input.label.trim()
    if (!label) throw new ValidationError('CHANNEL_LABEL_REQUIRED', 'label required')
    patch.label = label
  }
  if (input.config !== undefined) patch.config = input.config
  if (input.externalId !== undefined) patch.externalId = input.externalId
  if (input.enabled !== undefined) patch.enabled = input.enabled

  if (Object.keys(patch).length === 0) return existing

  const [updated] = await db
    .update(inboxChannels)
    .set(patch)
    .where(eq(inboxChannels.id, channelId))
    .returning()
  void dispatchInboxChannelUpdated(
    inboxChannelActor,
    inboxChannelRef(updated),
    Object.keys(patch)
  ).catch(() => {})
  return updated
}

export async function archiveInboxChannel(channelId: InboxChannelId): Promise<InboxChannel> {
  const existing = await getInboxChannel(channelId)
  if (!existing) throw new NotFoundError('CHANNEL_NOT_FOUND', 'Channel not found')
  if (existing.archivedAt) return existing
  const [updated] = await db
    .update(inboxChannels)
    .set({ archivedAt: new Date(), enabled: false })
    .where(eq(inboxChannels.id, channelId))
    .returning()
  void dispatchInboxChannelArchived(inboxChannelActor, inboxChannelRef(updated)).catch(() => {})
  return updated
}

export async function getInboxChannel(
  channelId: InboxChannelId
): Promise<InboxChannel | undefined> {
  return db.query.inboxChannels.findFirst({ where: eq(inboxChannels.id, channelId) })
}

export async function getInboxChannelByExternalId(
  kind: InboxChannelKind,
  externalId: string
): Promise<InboxChannel | undefined> {
  return db.query.inboxChannels.findFirst({
    where: and(
      eq(inboxChannels.kind, kind),
      eq(inboxChannels.externalId, externalId),
      isNull(inboxChannels.archivedAt)
    ),
  })
}

export async function listChannelsForInbox(inboxId: InboxId): Promise<InboxChannel[]> {
  return db
    .select()
    .from(inboxChannels)
    .where(eq(inboxChannels.inboxId, inboxId))
    .orderBy(asc(inboxChannels.createdAt))
}
