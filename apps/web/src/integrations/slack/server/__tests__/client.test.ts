/**
 * slackClient is `new WebClient(token, options)` unless the e2e harness gate
 * is open and a provider fake is configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const constructed = vi.hoisted(() => [] as unknown[][])
vi.mock('@slack/web-api', () => ({
  WebClient: class {
    constructor(...args: unknown[]) {
      constructed.push(args)
    }
  },
}))

import { slackClient } from '../client'

const KEYS = ['E2E_HARNESS', 'BASE_URL', 'QUACKBACK_TENANCY', 'E2E_PROVIDER_FAKE_URL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  constructed.length = 0
  for (const key of KEYS) saved[key] = process.env[key]
  process.env.BASE_URL = 'http://acme.localhost:3000'
  process.env.E2E_PROVIDER_FAKE_URL = 'http://127.0.0.1:4013'
  delete process.env.E2E_HARNESS
  delete process.env.QUACKBACK_TENANCY
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('slackClient', () => {
  it('passes the token and options through untouched when the gate is closed', () => {
    slackClient('xoxb-1')
    slackClient('xoxb-2', { timeout: 20_000 })
    expect(constructed).toEqual([['xoxb-1'], ['xoxb-2', { timeout: 20_000 }]])
  })

  it('adds no slackApiUrl on a public BASE_URL even with the flag and a fake set', () => {
    process.env.E2E_HARNESS = '1'
    process.env.BASE_URL = 'https://feedback.example.com'
    slackClient('xoxb-1', { timeout: 1 })
    expect(constructed).toEqual([['xoxb-1', { timeout: 1 }]])
  })

  it('points the SDK at the fake behind the gate', () => {
    process.env.E2E_HARNESS = '1'
    slackClient('xoxb-1', { timeout: 1 })
    slackClient()
    expect(constructed).toEqual([
      ['xoxb-1', { timeout: 1, slackApiUrl: 'http://127.0.0.1:4013/slack.com/api/' }],
      [undefined, { slackApiUrl: 'http://127.0.0.1:4013/slack.com/api/' }],
    ])
  })
})
