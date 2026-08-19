import { describe, it, expect } from 'vitest'
import { getEventDefinition } from '../catalogue'

/**
 * WO-6a — the identity/admin plane gains catalogue-declared, audit-relevant
 * events (emitted directly via emit() from their services). This verifies the
 * declarations + their audit/exposure contract + precise payloads. The service
 * call sites are covered by the api-key service tests (which now also write an
 * outbox row); the emit mechanism itself is covered by emit.test.ts.
 */
describe('admin-plane catalogue events (WO-6a)', () => {
  it('declares apikey.created / apikey.deleted / settings.updated as audit events', () => {
    for (const type of ['apikey.created', 'apikey.deleted', 'settings.updated']) {
      const def = getEventDefinition(type)
      expect(def, type).toBeDefined()
      expect(def!.exposure.audit, `${type} should be audited`).toBe(true)
      // Admin events are internal — never webhook/workflow surfaced.
      expect(def!.exposure.webhook).toBe(false)
      expect(def!.exposure.workflow).toBe(false)
    }
  })

  it('apikey.created payload validates a fixture', () => {
    const def = getEventDefinition('apikey.created')!
    expect(
      def.payload.parse({ apiKeyId: 'api_key_x', name: 'CI', scopes: ['posts:read'] })
    ).toMatchObject({ name: 'CI' })
    expect(() => def.payload.parse({ apiKeyId: 'api_key_x' })).toThrow()
  })
})
