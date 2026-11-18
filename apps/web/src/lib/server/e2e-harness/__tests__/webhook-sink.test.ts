import { describe, expect, it } from 'vitest'
import { isE2eWebhookSinkUrl, isLoopbackAddress } from '../webhook-sink'

const ENV = {
  E2E_HARNESS: '1',
  BASE_URL: 'http://acme.localhost:3000',
  E2E_WEBHOOK_SINK_HOST: 'webhook-sink.localhost:4011',
}
const SINK = 'https://webhook-sink.localhost:4011/hooks/abc'

describe('isE2eWebhookSinkUrl', () => {
  it('accepts exactly the configured https host and port behind the gate', () => {
    expect(isE2eWebhookSinkUrl(SINK, ENV)).toBe(true)
    expect(isE2eWebhookSinkUrl('https://WEBHOOK-SINK.localhost:4011/', ENV)).toBe(true)
  })

  it('is refused without the harness flag', () => {
    expect(isE2eWebhookSinkUrl(SINK, { ...ENV, E2E_HARNESS: undefined })).toBe(false)
  })

  it('is refused with the flag on a public BASE_URL', () => {
    expect(isE2eWebhookSinkUrl(SINK, { ...ENV, BASE_URL: 'https://feedback.example.com' })).toBe(
      false
    )
  })

  it('is refused when no sink is configured', () => {
    expect(isE2eWebhookSinkUrl(SINK, { ...ENV, E2E_WEBHOOK_SINK_HOST: undefined })).toBe(false)
  })

  it('refuses http, another port, another host and look-alikes', () => {
    expect(isE2eWebhookSinkUrl('http://webhook-sink.localhost:4011/', ENV)).toBe(false)
    expect(isE2eWebhookSinkUrl('https://webhook-sink.localhost:4012/', ENV)).toBe(false)
    expect(isE2eWebhookSinkUrl('https://webhook-sink.localhost/', ENV)).toBe(false)
    expect(isE2eWebhookSinkUrl('https://other.localhost:4011/', ENV)).toBe(false)
    expect(isE2eWebhookSinkUrl('https://localhost:4011/', ENV)).toBe(false)
    expect(isE2eWebhookSinkUrl('https://webhook-sink.localhost.evil.com:4011/', ENV)).toBe(false)
    expect(isE2eWebhookSinkUrl('https://127.0.0.1:4011/', ENV)).toBe(false)
  })

  it('refuses a configured sink that is not a loopback name', () => {
    for (const host of ['10.0.0.5:4011', '127.0.0.1:4011', 'hooks.example.com:443', '[::1]:4011']) {
      const env = { ...ENV, E2E_WEBHOOK_SINK_HOST: host }
      expect(isE2eWebhookSinkUrl(`https://${host}/`, env), host).toBe(false)
    }
  })
})

describe('isLoopbackAddress', () => {
  it('accepts loopback only, not other private ranges', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('127.10.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('10.0.0.1')).toBe(false)
    expect(isLoopbackAddress('169.254.169.254')).toBe(false)
    expect(isLoopbackAddress('192.168.1.1')).toBe(false)
    expect(isLoopbackAddress('fd00::1')).toBe(false)
    expect(isLoopbackAddress('93.184.216.34')).toBe(false)
  })
})
