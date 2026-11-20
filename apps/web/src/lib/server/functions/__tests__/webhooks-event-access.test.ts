/**
 * The Developers > Webhooks dialog subscribes only to events the signed-in
 * teammate can view: a role with `webhook.manage` but no inbox access cannot
 * route internal notes or ticket replies to an endpoint of its choosing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ForbiddenError } from '@/lib/shared/errors'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  getWebhookById: vi.fn(),
}))

vi.mock('../auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/webhooks/webhook.service', () => ({
  createWebhook: hoisted.createWebhook,
  updateWebhook: hoisted.updateWebhook,
  getWebhookById: hoisted.getWebhookById,
}))

import { createWebhookFn, updateWebhookFn } from '../webhooks'

const WEBHOOK_ID = createId('webhook')
const SINK = 'https://sink.example.com/hook'

/** A teammate whose custom role manages webhooks and reads feedback, nothing else. */
function signInWith(permissions: PermissionKey[]) {
  hoisted.requireAuth.mockResolvedValue({
    principal: { id: createId('principal') },
    permissions,
  })
}

const WEBHOOKS_ONLY: PermissionKey[] = [
  PERMISSIONS.WEBHOOK_VIEW,
  PERMISSIONS.WEBHOOK_MANAGE,
  PERMISSIONS.API_KEY_MANAGE,
  PERMISSIONS.POST_VIEW_PRIVATE,
]

type Fn = (args: { data: unknown }) => Promise<unknown>

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.createWebhook.mockImplementation(async (input: { events: string[] }) => ({
    webhook: { id: WEBHOOK_ID, events: input.events },
    secret: 'whsec_test',
  }))
  hoisted.updateWebhook.mockResolvedValue({ id: WEBHOOK_ID })
  hoisted.getWebhookById.mockResolvedValue({ id: WEBHOOK_ID, events: ['ticket.note_added'] })
})

describe('createWebhookFn', () => {
  it('refuses conversation events to a role without conversation access', async () => {
    signInWith(WEBHOOKS_ONLY)

    await expect(
      (createWebhookFn as unknown as Fn)({
        data: { url: SINK, events: ['post.created', 'message.note_created'] },
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(hoisted.createWebhook).not.toHaveBeenCalled()
  })

  it('refuses ticket events to a role without ticket access', async () => {
    signInWith([...WEBHOOKS_ONLY, PERMISSIONS.CONVERSATION_VIEW])

    await expect(
      (createWebhookFn as unknown as Fn)({ data: { url: SINK, events: ['ticket.note_added'] } })
    ).rejects.toThrow(/ticket\.view/)
    expect(hoisted.createWebhook).not.toHaveBeenCalled()
  })

  it('creates a webhook for the events the role can view', async () => {
    signInWith(WEBHOOKS_ONLY)

    await (createWebhookFn as unknown as Fn)({ data: { url: SINK, events: ['post.created'] } })

    expect(hoisted.createWebhook).toHaveBeenCalledOnce()
  })
})

describe('updateWebhookFn', () => {
  it('refuses to point a ticket webhook at a new URL for a role without ticket access', async () => {
    signInWith(WEBHOOKS_ONLY)

    await expect(
      (updateWebhookFn as unknown as Fn)({ data: { webhookId: WEBHOOK_ID, url: SINK } })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(hoisted.updateWebhook).not.toHaveBeenCalled()
  })

  it('lets the same role pause it', async () => {
    signInWith(WEBHOOKS_ONLY)

    await (updateWebhookFn as unknown as Fn)({
      data: { webhookId: WEBHOOK_ID, status: 'disabled' },
    })

    expect(hoisted.updateWebhook).toHaveBeenCalledOnce()
  })
})
