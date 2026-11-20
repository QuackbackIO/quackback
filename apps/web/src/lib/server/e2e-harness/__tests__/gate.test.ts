import { describe, expect, it } from 'vitest'
import { isE2eHarnessEnabled, isLoopbackHostname } from '../gate'

const ON = { E2E_HARNESS: '1', BASE_URL: 'http://acme.localhost:3000' }

describe('isE2eHarnessEnabled', () => {
  it('opens with the flag on a loopback BASE_URL', () => {
    expect(isE2eHarnessEnabled(ON)).toBe(true)
    expect(isE2eHarnessEnabled({ ...ON, BASE_URL: 'http://localhost:3000' })).toBe(true)
    expect(isE2eHarnessEnabled({ ...ON, BASE_URL: 'http://127.0.0.1:3000' })).toBe(true)
    expect(isE2eHarnessEnabled({ ...ON, BASE_URL: 'http://[::1]:3000' })).toBe(true)
  })

  it('stays closed without the flag, in development or production', () => {
    expect(isE2eHarnessEnabled({ BASE_URL: ON.BASE_URL })).toBe(false)
    expect(isE2eHarnessEnabled({ BASE_URL: ON.BASE_URL, NODE_ENV: 'development' })).toBe(false)
    expect(isE2eHarnessEnabled({ BASE_URL: ON.BASE_URL, NODE_ENV: 'production' })).toBe(false)
    expect(isE2eHarnessEnabled({ ...ON, E2E_HARNESS: 'true' })).toBe(false)
    expect(isE2eHarnessEnabled({ ...ON, E2E_HARNESS: '0' })).toBe(false)
  })

  it('stays closed with the flag on a deployment people use', () => {
    for (const base of [
      'https://feedback.example.com',
      'https://acme.quackback.io',
      'http://10.0.0.5:3000',
      'http://192.168.1.20',
      'https://localhost.example.com',
      'https://example.com/localhost',
    ]) {
      expect(isE2eHarnessEnabled({ ...ON, BASE_URL: base }), base).toBe(false)
    }
  })

  it('stays closed when BASE_URL is missing or unreadable', () => {
    expect(isE2eHarnessEnabled({ E2E_HARNESS: '1' })).toBe(false)
    expect(isE2eHarnessEnabled({ E2E_HARNESS: '1', BASE_URL: 'not a url' })).toBe(false)
  })

  it('stays closed on the pooled fleet', () => {
    expect(isE2eHarnessEnabled({ ...ON, QUACKBACK_TENANCY: 'pooled' })).toBe(false)
  })
})

describe('isLoopbackHostname', () => {
  it('accepts loopback names and addresses only', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('webhook-sink.localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('localhost.example.com')).toBe(false)
    expect(isLoopbackHostname('mylocalhost')).toBe(false)
    expect(isLoopbackHostname('10.0.0.1')).toBe(false)
    expect(isLoopbackHostname('128.0.0.1')).toBe(false)
  })
})
