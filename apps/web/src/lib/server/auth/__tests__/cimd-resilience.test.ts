import { describe, expect, it, vi } from 'vitest'
import { APIError } from 'better-auth/api'
import type { ClientDiscovery } from '@better-auth/oauth-provider'

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import {
  CIMD_MAX_STALE_MS,
  isClientIdMetadataUrlAllowed,
  isTransientCimdFailure,
  ownHostsOf,
  resilientDiscovery,
} from '@/lib/server/auth/cimd'

const CLIENT_ID = 'https://chat.example.com/oauth/client.json'
const NOW = Date.UTC(2026, 10, 19, 12)

const invalidClient = (description: string) =>
  new APIError('BAD_REQUEST', { error: 'invalid_client', error_description: description })
const unavailable = (description: string) =>
  new APIError('TOO_MANY_REQUESTS', {
    error: 'temporarily_unavailable',
    error_description: description,
  })

const NETWORK = invalidClient(
  'Failed to fetch metadata document (network error or redirect blocked)'
)

function storedClient(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    clientDiscoveryId: 'cimd',
    disabled: false,
    redirectUris: ['https://chat.example.com/cb'],
    createdAt: new Date(NOW - 30 * 86_400_000),
    updatedAt: new Date(NOW - 60_000),
    ...overrides,
  } as never
}

function discoveryThatFails(error: unknown): ClientDiscovery {
  return {
    id: 'cimd',
    matches: () => true,
    resolve: vi.fn(async () => {
      throw error
    }),
  }
}

const resolve = (discovery: ClientDiscovery, existing: unknown) =>
  resilientDiscovery(discovery, { now: () => NOW }).resolve(
    {} as never,
    CLIENT_ID,
    existing as never
  )

describe('isTransientCimdFailure', () => {
  it.each([
    ['a network error', NETWORK],
    ['a timeout', invalidClient('Metadata document fetch timed out after 5000ms')],
    ['a 503', invalidClient('Metadata document fetch returned HTTP 503')],
    ['a 429', invalidClient('Metadata document fetch returned HTTP 429')],
    ['a 408', invalidClient('Metadata document fetch returned HTTP 408')],
    ['the fetch budget', unavailable('global metadata fetch rate limit exceeded')],
    [
      'the per-client minimum interval',
      unavailable('metadata document fetch is within the per-client minimum interval'),
    ],
  ])('treats %s as transient', (_label, error) => {
    expect(isTransientCimdFailure(error)).toBe(true)
  })

  it.each([
    ['a 404', invalidClient('Metadata document fetch returned HTTP 404')],
    ['a 410', invalidClient('Metadata document fetch returned HTTP 410')],
    [
      'a document for another client',
      invalidClient('client_id in metadata document does not match'),
    ],
    ['HTML', invalidClient('Metadata document must be JSON (got Content-Type "text/html")')],
    ['invalid JSON', invalidClient('Metadata document is not valid JSON')],
    [
      'the fetch policy',
      invalidClient("client_id URL is not permitted by the server's fetch policy"),
    ],
    ['an unrelated error', new Error('boom')],
    ['nothing', null],
  ])('treats %s as terminal', (_label, error) => {
    expect(isTransientCimdFailure(error)).toBe(false)
  })
})

describe('resilientDiscovery', () => {
  it('keeps a recently validated client when its document host is briefly unreachable', async () => {
    const existing = storedClient()
    await expect(resolve(discoveryThatFails(NETWORK), existing)).resolves.toBe(existing)
  })

  it('keeps a client when this server has spent its fetch budget', async () => {
    const existing = storedClient()
    const error = unavailable('metadata fetch rate limit exceeded for client origin')
    await expect(resolve(discoveryThatFails(error), existing)).resolves.toBe(existing)
  })

  it('fails closed when the document is gone or no longer valid', async () => {
    const error = invalidClient('Metadata document fetch returned HTTP 404')
    await expect(resolve(discoveryThatFails(error), storedClient())).rejects.toBe(error)
  })

  it('fails closed on a first fetch, with no stored client to fall back to', async () => {
    await expect(resolve(discoveryThatFails(NETWORK), null)).rejects.toBe(NETWORK)
  })

  it('fails closed once the stored client is older than the stale limit', async () => {
    const existing = storedClient({ updatedAt: new Date(NOW - CIMD_MAX_STALE_MS - 1) })
    await expect(resolve(discoveryThatFails(NETWORK), existing)).rejects.toBe(NETWORK)
  })

  it('never falls back to a disabled client or one another discovery owns', async () => {
    await expect(
      resolve(discoveryThatFails(NETWORK), storedClient({ disabled: true }))
    ).rejects.toBe(NETWORK)
    await expect(
      resolve(discoveryThatFails(NETWORK), storedClient({ clientDiscoveryId: null }))
    ).rejects.toBe(NETWORK)
  })

  it('passes a successful resolution through untouched', async () => {
    const fresh = storedClient({ updatedAt: new Date(NOW) })
    const discovery: ClientDiscovery = {
      id: 'cimd',
      matches: () => true,
      resolve: async () => fresh,
    }
    await expect(resolve(discovery, storedClient())).resolves.toBe(fresh)
  })
})

describe('own hosts', () => {
  it('refuses a client_id served by this server', () => {
    const own = ['feedback.quackback.io', 'feedback.example.com']
    expect(isClientIdMetadataUrlAllowed('https://feedback.quackback.io/files/doc.json', own)).toBe(
      false
    )
    expect(isClientIdMetadataUrlAllowed('https://FEEDBACK.example.com/x.json', own)).toBe(false)
    expect(isClientIdMetadataUrlAllowed('https://chatgpt.com/oauth/client.json', own)).toBe(true)
  })

  it('collects the base URL host and the request host', () => {
    expect(
      ownHostsOf({
        context: { baseURL: 'https://feedback.quackback.io/api/auth' },
        request: new Request('https://feedback.example.com/api/auth/oauth2/authorize'),
        headers: new Headers({
          host: 'feedback.example.com',
          'x-forwarded-host': 'edge.example.com',
        }),
      }).sort()
    ).toEqual(['edge.example.com', 'feedback.example.com', 'feedback.quackback.io'])
  })
})
