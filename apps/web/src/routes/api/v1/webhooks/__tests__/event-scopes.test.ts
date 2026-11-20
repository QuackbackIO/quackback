/**
 * A webhook subscription is a read of every event it receives, so creating or
 * re-pointing one needs what reading those events needs: the key's read scope
 * for each event, and its creator's view permission. Managing webhooks is
 * workspace configuration, so it rides the settings scopes, not feedback's.
 *
 * The real `withApiKeyAuth` runs; only the key lookup, the creator's authority
 * and the webhook service are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ApiKeyId, type PrincipalId } from '@quackback/ids'
import type { ApiKey, ApiKeyScope } from '@/lib/server/domains/api-keys'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

const { mockVerify, mockAuthority, service } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockAuthority: vi.fn(),
  service: {
    createWebhook: vi.fn(),
    updateWebhook: vi.fn(),
    getWebhookById: vi.fn(),
    listWebhooks: vi.fn(),
  },
}))

vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  verifyApiKey: (...args: unknown[]) => mockVerify(...args),
}))
vi.mock('@/lib/server/domains/api-keys/api-key-authority', () => ({
  resolveApiKeyAuthority: (...args: unknown[]) => mockAuthority(...args),
}))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 100 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
  hasRecentApiKeyFailure: vi.fn(async () => false),
  recordApiKeyFailure: vi.fn(async () => {}),
  apiRateLimitRetryAfter: vi.fn(async () => 60),
}))
vi.mock('@/lib/server/domains/webhooks/webhook.service', () => ({
  createWebhook: (...args: unknown[]) => service.createWebhook(...args),
  updateWebhook: (...args: unknown[]) => service.updateWebhook(...args),
  getWebhookById: (...args: unknown[]) => service.getWebhookById(...args),
  listWebhooks: (...args: unknown[]) => service.listWebhooks(...args),
}))

import { Route as WebhooksRoute } from '../index'
import { Route as WebhookRoute } from '../$webhookId'

type Handler = (args: { request: Request; params: Record<string, string> }) => Promise<Response>
type Handlers = { GET: Handler; POST: Handler; PATCH: Handler }
const handlers = (route: unknown): Handlers =>
  (route as { options: { server: { handlers: Handlers } } }).options.server.handlers

const NOW = new Date('2026-11-01T00:00:00Z')
const WEBHOOK_ID = createId('webhook')
const SINK = 'https://sink.example.com/hook'

function webhookRow(events: string[]) {
  return {
    id: WEBHOOK_ID,
    url: SINK,
    events,
    boardIds: null,
    status: 'active',
    failureCount: 0,
    lastError: null,
    lastTriggeredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const KEY: ApiKey = {
  id: 'apikey_01h455vb4pex5vsknk084sn02q' as ApiKeyId,
  name: 'Integration',
  kind: 'personal',
  keyPrefix: 'qb_test',
  principalId: 'principal_01h455vb4pex5vsknk084sn02s' as PrincipalId,
  createdById: 'principal_01h455vb4pex5vsknk084sn02r' as PrincipalId,
  createdAt: NOW,
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  scopes: null,
}

/** A key with `scopes` whose creator currently holds `permissions`. */
function useKey(scopes: ApiKeyScope[] | null, permissions: Iterable<PermissionKey>) {
  mockVerify.mockResolvedValue({ ...KEY, scopes })
  mockAuthority.mockResolvedValue({
    principal: { type: 'service', role: 'admin' },
    owner: null,
    role: 'admin',
    permissions: new Set(permissions),
    scopePrincipalId: null,
  })
}

const OWNER = resolveActorPermissions('admin')

function json(method: string, path: string, body?: unknown): Request {
  return new Request(`https://example.com/api/v1/${path}`, {
    method,
    headers: { Authorization: 'Bearer qb_test', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const create = (events: string[]) =>
  handlers(WebhooksRoute).POST({
    request: json('POST', 'webhooks', { url: SINK, events }),
    params: {},
  })
const patch = (body: Record<string, unknown>) =>
  handlers(WebhookRoute).PATCH({
    request: json('PATCH', `webhooks/${WEBHOOK_ID}`, body),
    params: { webhookId: WEBHOOK_ID },
  })

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  return ((await res.json()) as { error: { code: string; message: string } }).error
}

beforeEach(() => {
  vi.clearAllMocks()
  service.createWebhook.mockImplementation(async (input: { events: string[] }) => ({
    webhook: webhookRow(input.events),
    secret: 'whsec_test',
  }))
  service.updateWebhook.mockImplementation(async (_id: string, input: { events?: string[] }) =>
    webhookRow(input.events ?? ['message.note_created'])
  )
  service.getWebhookById.mockResolvedValue(webhookRow(['message.note_created']))
  service.listWebhooks.mockResolvedValue([])
})

describe('managing webhooks rides the settings scopes', () => {
  it('refuses a feedback-only key that used to manage webhooks', async () => {
    useKey(['read:feedback', 'write:feedback'], OWNER)

    const res = await create(['post.created'])

    expect(res.status).toBe(403)
    expect((await errorOf(res)).message).toContain("'write:settings'")
    expect(service.createWebhook).not.toHaveBeenCalled()
  })

  it('lists webhooks with read:settings', async () => {
    useKey(['read:settings'], OWNER)

    const res = await handlers(WebhooksRoute).GET({ request: json('GET', 'webhooks'), params: {} })

    expect(res.status).toBe(200)
  })

  it('refuses to list webhooks with read:feedback alone', async () => {
    useKey(['read:feedback'], OWNER)

    const res = await handlers(WebhooksRoute).GET({ request: json('GET', 'webhooks'), params: {} })

    expect(res.status).toBe(403)
    expect((await errorOf(res)).message).toContain("'read:settings'")
  })
})

describe('creating a webhook needs the read scope of every event', () => {
  it('subscribes a settings key to the feedback events it can read', async () => {
    useKey(['write:settings', 'read:feedback'], OWNER)

    const res = await create(['post.created', 'comment.created'])

    expect(res.status).toBe(201)
    expect(service.createWebhook).toHaveBeenCalledOnce()
  })

  it('refuses chat events to a key without read:chat, naming the event', async () => {
    useKey(['write:settings', 'read:feedback'], OWNER)

    const res = await create(['post.created', 'message.note_created'])

    expect(res.status).toBe(403)
    const error = await errorOf(res)
    expect(error.code).toBe('FORBIDDEN')
    expect(error.message).toContain("'read:chat'")
    expect(error.message).toContain('message.note_created')
    expect(service.createWebhook).not.toHaveBeenCalled()
  })

  it('refuses ticket events to a key without read:chat', async () => {
    useKey(['write:settings', 'read:feedback'], OWNER)

    const res = await create(['ticket.note_added'])

    expect(res.status).toBe(403)
    expect(service.createWebhook).not.toHaveBeenCalled()
  })

  it('subscribes a key holding read:chat to chat events', async () => {
    useKey(['write:settings', 'read:chat'], OWNER)

    const res = await create(['message.created', 'ticket.note_added'])

    expect(res.status).toBe(201)
  })
})

describe("creating a webhook needs the creator's view permission for every event", () => {
  it('refuses chat events when the creator cannot view conversations', async () => {
    useKey(null, [
      PERMISSIONS.WEBHOOK_VIEW,
      PERMISSIONS.WEBHOOK_MANAGE,
      PERMISSIONS.POST_VIEW_PRIVATE,
    ])

    const res = await create(['message.created'])

    expect(res.status).toBe(403)
    expect((await errorOf(res)).message).toContain('conversation.view')
    expect(service.createWebhook).not.toHaveBeenCalled()
  })

  it('refuses ticket events when the creator cannot view tickets', async () => {
    useKey(null, [
      PERMISSIONS.WEBHOOK_MANAGE,
      PERMISSIONS.CONVERSATION_VIEW,
      PERMISSIONS.POST_VIEW_PRIVATE,
    ])

    const res = await create(['ticket.created'])

    expect(res.status).toBe(403)
    expect((await errorOf(res)).message).toContain('ticket.view')
  })

  it('subscribes the creator to events they can view', async () => {
    useKey(null, [PERMISSIONS.WEBHOOK_MANAGE, PERMISSIONS.POST_VIEW_PRIVATE])

    const res = await create(['post.created'])

    expect(res.status).toBe(201)
  })
})

describe('updating a webhook', () => {
  it('refuses new events the key cannot read', async () => {
    useKey(['write:settings', 'read:feedback'], OWNER)

    const res = await patch({ events: ['conversation.created'] })

    expect(res.status).toBe(403)
    expect(service.updateWebhook).not.toHaveBeenCalled()
  })

  it('refuses to re-point a webhook whose events the key cannot read', async () => {
    useKey(['write:settings', 'read:feedback'], OWNER)

    const res = await patch({ url: 'https://attacker.example.com/hook' })

    expect(res.status).toBe(403)
    expect((await errorOf(res)).message).toContain('message.note_created')
    expect(service.updateWebhook).not.toHaveBeenCalled()
  })

  it('lets the same key save the stored URL and events unchanged, as the edit dialog does', async () => {
    useKey(['write:settings', 'read:feedback'], OWNER)

    const res = await patch({ url: SINK, events: ['message.note_created'], status: 'disabled' })

    expect(res.status).toBe(200)
    expect(service.updateWebhook).toHaveBeenCalledOnce()
  })

  it('refuses adding a chat event next to the stored ones', async () => {
    useKey(['write:settings', 'read:feedback'], OWNER)

    const res = await patch({ url: SINK, events: ['message.note_created', 'ticket.created'] })

    expect(res.status).toBe(403)
    expect((await errorOf(res)).message).toContain('ticket.created')
  })

  it('lets the same key pause a webhook it cannot re-point', async () => {
    useKey(['write:settings', 'read:feedback'], OWNER)

    const res = await patch({ status: 'disabled' })

    expect(res.status).toBe(200)
    expect(service.updateWebhook).toHaveBeenCalledOnce()
  })

  it('re-points a webhook whose events the key can read', async () => {
    useKey(['write:settings', 'read:chat'], OWNER)

    const res = await patch({ url: 'https://sink2.example.com/hook' })

    expect(res.status).toBe(200)
  })
})
