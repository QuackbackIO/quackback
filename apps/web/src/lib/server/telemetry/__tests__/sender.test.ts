import { describe, expect, it } from 'vitest'
import { toPostHogEvent } from '../sender'

describe('toPostHogEvent', () => {
  const payload = { version: '1.2.3', instanceId: 'inst-1', cloud: false, seats7d: '1-10' }

  it('captures one instance_ping keyed by the instance id', () => {
    const event = toPostHogEvent(payload as never, { apiKey: 'phc_test' })
    expect(event.api_key).toBe('phc_test')
    expect(event.event).toBe('instance_ping')
    expect(event.distinct_id).toBe('inst-1')
    expect(event.properties).toMatchObject({ version: '1.2.3', seats7d: '1-10' })
  })

  it('keeps the latest snapshot on the instance profile', () => {
    const event = toPostHogEvent(payload as never, { apiKey: 'phc_test' })
    expect(event.properties.$set).toMatchObject({ version: '1.2.3', seats7d: '1-10' })
  })

  it('never lets the server address become a location', () => {
    const event = toPostHogEvent(payload as never, { apiKey: 'phc_test' })
    expect(event.properties.$geoip_disable).toBe(true)
    expect(event.properties.$ip).toBeNull()
  })

  it('joins a hosted workspace to its admin analytics group, and nothing else', () => {
    const selfHosted = toPostHogEvent(payload as never, { apiKey: 'k', workspaceId: 'ws_1' })
    expect(selfHosted.properties.$groups).toBeUndefined()

    const hosted = toPostHogEvent({ ...payload, cloud: true } as never, {
      apiKey: 'k',
      workspaceId: 'ws_1',
    })
    expect(hosted.properties.$groups).toEqual({ workspace: 'ws_1' })
  })
})
