/**
 * The _template is a compiling, contract-satisfying fixture (IF WO-12). Being
 * under src/ it is already typechecked every run; this test additionally asserts
 * it satisfies the runtime shape a real provider must, so the template can never
 * drift from the IntegrationDefinition contract it teaches.
 */
import { describe, it, expect } from 'vitest'
import { templateIntegration } from '../server'

describe('_template provider fixture', () => {
  it('satisfies the core IntegrationDefinition contract', () => {
    expect(templateIntegration.id).toBe('template')
    expect(templateIntegration.catalog.id).toBe('template')
    expect(Array.isArray(templateIntegration.platformCredentials)).toBe(true)
  })

  it('is a fixture, not a live provider (never connectable)', () => {
    expect(templateIntegration.catalog.available).toBe(false)
  })

  it('demonstrates the WO-7 dependent-destination shape', () => {
    const dest = templateIntegration.destinations!
    expect(dest.project).toBeTruthy()
    expect(dest['issue-type'].childOf).toBe('project')
  })

  it('demonstrates the WO-15 two-way slots', () => {
    expect(typeof templateIntegration.remoteStatus?.push).toBe('function')
    expect(typeof templateIntegration.externalLinks?.search).toBe('function')
  })
})
