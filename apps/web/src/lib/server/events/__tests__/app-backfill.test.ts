import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => {
  const { createDb } = await import('@quackback/db/client')
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: createDb(url, { max: 5, prepare: false }),
  }
})

import { db, apps, events } from '@/lib/server/db'
import { createId } from '@quackback/ids'
import { backfillAppSubscription, deliverableTypes } from '../app-backfill'

/** WO-14 — per-app backfill: scope-filtered, dry-run count, deterministic replay. */

async function seedPublishedEvent(type: string, entityId: string): Promise<void> {
  await db.insert(events).values({
    eventId: createId('event'),
    type,
    entityType: 'post',
    entityId,
    actorType: 'user',
    payload: { postId: entityId },
    context: { depth: 0 },
    schemaVersion: 1,
    publishedAt: new Date(),
  })
}

describe('app backfill (WO-14)', () => {
  it('deliverableTypes = subscribed ∩ scoped', () => {
    // posts:read is the requiredScope for post.created; conversations:read is not held.
    const app = {
      subscribedEventTypes: ['post.created', 'conversation.created'],
      grantedScopes: ['read:feedback'],
    }
    expect(deliverableTypes(app)).toEqual(['post.created'])
  })

  it('dry-run counts matched published events without enqueuing', async () => {
    const appId = createId('app')
    const marker = createId('post')
    await db.insert(apps).values({
      id: appId,
      oauthClientId: createId('app'),
      name: 'Backfill App',
      grantedScopes: ['read:feedback'],
      subscribedEventTypes: ['post.created'],
      webhookEndpoint: 'https://app.example/hook',
      status: 'active',
    })
    await seedPublishedEvent('post.created', marker)
    await seedPublishedEvent('post.created', marker)
    await seedPublishedEvent('comment.created', marker) // not subscribed

    const dry = await backfillAppSubscription(appId, { dryRun: true })
    expect(dry.matched).toBeGreaterThanOrEqual(2)
    expect(dry.enqueued).toBe(0)
  })

  it('replay enqueues one deterministic job per matched event', async () => {
    const appId = createId('app')
    await db.insert(apps).values({
      id: appId,
      oauthClientId: createId('app'),
      name: 'Replay App',
      grantedScopes: ['read:feedback'],
      subscribedEventTypes: ['post.created'],
      webhookEndpoint: 'https://app.example/hook',
      status: 'active',
    })
    const enqueued: Array<{ jobId: string }> = []
    const res = await backfillAppSubscription(appId, {
      dryRun: false,
      enqueue: async (jobs) => {
        enqueued.push(...jobs)
      },
    })
    expect(res.enqueued).toBe(res.matched)
    for (const j of enqueued) {
      expect(j.jobId).toMatch(new RegExp(`:app_webhook:${appId}$`))
    }
  })

  it('an app with no scope for its subscribed types backfills nothing', async () => {
    const appId = createId('app')
    await db.insert(apps).values({
      id: appId,
      oauthClientId: createId('app'),
      name: 'Unscoped App',
      grantedScopes: ['read:chat'],
      subscribedEventTypes: ['post.created'],
      webhookEndpoint: 'https://app.example/hook',
      status: 'active',
    })
    expect(await backfillAppSubscription(appId, { dryRun: true })).toEqual({
      matched: 0,
      enqueued: 0,
    })
  })
})
