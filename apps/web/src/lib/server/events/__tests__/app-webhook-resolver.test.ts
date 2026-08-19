import { describe, it, expect } from 'vitest'
import { appMatches, appWebhookResolver } from '../resolvers/app-webhook.resolver'

/**
 * WO-13 — the app-webhook resolver's scope gate: an app receives an event only
 * if it is active, has an endpoint, subscribes to the type, AND holds the
 * event's requiredScope. End-to-end delivery is the app-webhook hook (mirrors
 * the customer-webhook hook, already covered).
 */
const app = (over: Partial<Parameters<typeof appMatches>[0]> = {}) => ({
  status: 'active',
  webhookEndpoint: 'https://app.example/hook',
  subscribedEventTypes: ['post.created'],
  grantedScopes: ['read:feedback'],
  ...over,
})

describe('appMatches (WO-13 scope gate)', () => {
  it('matches an active, subscribed, sufficiently-scoped app', () => {
    expect(appMatches(app(), 'post.created', 'read:feedback')).toBe(true)
  })

  it('denies when the app lacks the required scope', () => {
    expect(appMatches(app({ grantedScopes: ['read:chat'] }), 'post.created', 'read:feedback')).toBe(
      false
    )
  })

  it('denies when not subscribed to the event type', () => {
    expect(
      appMatches(
        app({ subscribedEventTypes: ['comment.created'] }),
        'post.created',
        'read:feedback'
      )
    ).toBe(false)
  })

  it('denies a disabled app or one with no endpoint', () => {
    expect(appMatches(app({ status: 'disabled' }), 'post.created', 'read:feedback')).toBe(false)
    expect(appMatches(app({ webhookEndpoint: null }), 'post.created', 'read:feedback')).toBe(false)
  })

  it('denies when the event has no required scope (fail closed)', () => {
    expect(appMatches(app(), 'post.created', undefined)).toBe(false)
  })

  it('resolver interestedIn accepts any catalogue event', () => {
    expect(appWebhookResolver.interestedIn('post.created')).toBe(true)
    expect(appWebhookResolver.interestedIn('conversation.created')).toBe(true)
    expect(appWebhookResolver.interestedIn('not.a_real_event')).toBe(false)
  })
})
