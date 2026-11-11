import { describe, expect, it } from 'vitest'
import { shouldSendTelemetry } from '../config'

const prod = { disabled: false, isProd: true, ci: undefined }

describe('which processes send the instance ping', () => {
  it('sends from a production build', () => {
    expect(shouldSendTelemetry(prod)).toBe(true)
  })

  it('stays quiet when the operator turns it off', () => {
    expect(shouldSendTelemetry({ ...prod, disabled: true })).toBe(false)
  })

  it('stays quiet on a dev server or in tests, which start on a fresh database', () => {
    expect(shouldSendTelemetry({ ...prod, isProd: false })).toBe(false)
  })

  it('stays quiet in CI', () => {
    expect(shouldSendTelemetry({ ...prod, ci: 'true' })).toBe(false)
    expect(shouldSendTelemetry({ ...prod, ci: '1' })).toBe(false)
  })

  it('treats an explicit CI=false as not CI', () => {
    expect(shouldSendTelemetry({ ...prod, ci: 'false' })).toBe(true)
    expect(shouldSendTelemetry({ ...prod, ci: '0' })).toBe(true)
    expect(shouldSendTelemetry({ ...prod, ci: '' })).toBe(true)
  })
})
