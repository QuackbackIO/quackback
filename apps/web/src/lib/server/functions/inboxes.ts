/**
 * Inbox server functions — admin & agent surface for inbox CRUD,
 * channels, and memberships.
 *
 * - INBOX_VIEW for read endpoints
 * - INBOX_MANAGE for inbox CRUD + memberships
 * - INBOX_CHANNEL_MANAGE for channel CRUD
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type {
  InboxId,
  InboxChannelId,
  InboxMembershipId,
  PrincipalId,
  TeamId,
  TicketStatusId,
} from '@quackback/ids'
import { requirePermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import {
  createInbox,
  updateInbox,
  archiveInbox,
  unarchiveInbox,
  getInbox,
  listInboxes,
  addInboxMembership,
  updateInboxMembershipRole,
  removeInboxMembership,
  listMembershipsForInbox,
  listInboxRowsForPrincipal,
  addInboxChannel,
  updateInboxChannel,
  archiveInboxChannel,
  listChannelsForInbox,
} from '@/lib/server/domains/inboxes'
import {
  INBOX_CHANNEL_KINDS,
  INBOX_MEMBERSHIP_ROLES,
  TICKET_PRIORITIES,
  TICKET_VISIBILITY_SCOPES,
} from '@/lib/server/db'
import { recordEvent } from '@/lib/server/domains/audit'

const inboxIdSchema = z.string().min(1) as z.ZodType<InboxId>
const channelIdSchema = z.string().min(1) as z.ZodType<InboxChannelId>
const membershipIdSchema = z.string().min(1) as z.ZodType<InboxMembershipId>
const principalIdSchema = z.string().min(1) as z.ZodType<PrincipalId>
const teamIdSchema = z.string().min(1) as z.ZodType<TeamId>
const statusIdSchema = z.string().min(1) as z.ZodType<TicketStatusId>

// ---- inbox CRUD ----------------------------------------------------------

export const listInboxesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ includeArchived: z.boolean().optional() }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.INBOX_VIEW)
    return listInboxes({ includeArchived: data.includeArchived })
  })

export const getInboxFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ inboxId: inboxIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.INBOX_VIEW)
    return getInbox(data.inboxId)
  })

export const createInboxFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      slug: z.string().min(1).max(100),
      name: z.string().min(1).max(200),
      description: z.string().max(1000).nullable().optional(),
      primaryTeamId: teamIdSchema.nullable().optional(),
      defaultVisibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
      defaultPriority: z.enum(TICKET_PRIORITIES).optional(),
      defaultStatusId: statusIdSchema.nullable().optional(),
      color: z.string().max(16).nullable().optional(),
      icon: z.string().max(64).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_MANAGE)
    const inbox = await createInbox(data, { principalId: ctx.principal.id })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox.created',
      targetType: 'inbox',
      targetId: inbox.id,
      diff: { after: { slug: inbox.slug, name: inbox.name } },
    })
    return inbox
  })

export const updateInboxFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      inboxId: inboxIdSchema,
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      primaryTeamId: teamIdSchema.nullable().optional(),
      defaultVisibilityScope: z.enum(TICKET_VISIBILITY_SCOPES).optional(),
      defaultPriority: z.enum(TICKET_PRIORITIES).optional(),
      defaultStatusId: statusIdSchema.nullable().optional(),
      color: z.string().max(16).nullable().optional(),
      icon: z.string().max(64).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_MANAGE)
    const { inboxId, ...patch } = data
    const inbox = await updateInbox(inboxId, patch, { principalId: ctx.principal.id })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox.updated',
      targetType: 'inbox',
      targetId: inbox.id,
      diff: { after: patch },
    })
    return inbox
  })

export const archiveInboxFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ inboxId: inboxIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_MANAGE)
    const inbox = await archiveInbox(data.inboxId, { principalId: ctx.principal.id })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox.archived',
      targetType: 'inbox',
      targetId: inbox.id,
    })
    return inbox
  })

export const unarchiveInboxFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ inboxId: inboxIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_MANAGE)
    const inbox = await unarchiveInbox(data.inboxId, { principalId: ctx.principal.id })
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox.unarchived',
      targetType: 'inbox',
      targetId: inbox.id,
    })
    return inbox
  })

// ---- channels ------------------------------------------------------------

export const listInboxChannelsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ inboxId: inboxIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.INBOX_VIEW)
    return listChannelsForInbox(data.inboxId)
  })

export const addInboxChannelFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      inboxId: inboxIdSchema,
      kind: z.enum(INBOX_CHANNEL_KINDS),
      label: z.string().min(1).max(200),
      config: z.record(z.string(), z.unknown()).optional(),
      externalId: z.string().max(200).nullable().optional(),
      enabled: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_CHANNEL_MANAGE)
    const channel = await addInboxChannel(data as never)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox_channel.added',
      targetType: 'inbox_channel',
      targetId: channel.id,
      diff: { after: { inboxId: data.inboxId, kind: data.kind } },
    })
    return channel
  })

export const updateInboxChannelFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      channelId: channelIdSchema,
      label: z.string().min(1).max(200).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      externalId: z.string().max(200).nullable().optional(),
      enabled: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_CHANNEL_MANAGE)
    const { channelId, ...patch } = data
    const channel = await updateInboxChannel(channelId, patch as never)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox_channel.updated',
      targetType: 'inbox_channel',
      targetId: channel.id,
      diff: { after: patch as never },
    })
    return channel
  })

export const archiveInboxChannelFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ channelId: channelIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_CHANNEL_MANAGE)
    const channel = await archiveInboxChannel(data.channelId)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox_channel.archived',
      targetType: 'inbox_channel',
      targetId: channel.id,
    })
    return channel
  })

// ---- memberships ---------------------------------------------------------

export const listInboxMembershipsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ inboxId: inboxIdSchema }))
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.INBOX_VIEW)
    return listMembershipsForInbox(data.inboxId)
  })

export const listMyInboxesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({}).optional())
  .handler(async () => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_VIEW)
    return listInboxRowsForPrincipal(ctx.principal.id as PrincipalId)
  })

export const addInboxMembershipFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      inboxId: inboxIdSchema,
      principalId: principalIdSchema,
      role: z.enum(INBOX_MEMBERSHIP_ROLES),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_MANAGE)
    const m = await addInboxMembership(data)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox.membership_added',
      targetType: 'inbox',
      targetId: data.inboxId,
      diff: { after: { principalId: data.principalId, role: data.role } },
    })
    return m
  })

export const updateInboxMembershipRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      membershipId: membershipIdSchema,
      role: z.enum(INBOX_MEMBERSHIP_ROLES),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_MANAGE)
    const m = await updateInboxMembershipRole(data.membershipId, data.role)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox.membership_updated',
      targetType: 'inbox',
      targetId: m.inboxId,
      diff: { after: { role: data.role } },
    })
    return m
  })

export const removeInboxMembershipFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ membershipId: membershipIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requirePermission(PERMISSIONS.INBOX_MANAGE)
    await removeInboxMembership(data.membershipId)
    await recordEvent({
      principalId: ctx.principal.id,
      action: 'inbox.membership_removed',
      targetType: 'inbox_membership',
      targetId: data.membershipId,
    })
    return { ok: true }
  })
