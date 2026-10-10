/** Capability relationships, not provider-name lists, define conformance. */
import { describe, it, expect } from 'vitest'
import { getIntegration, listIntegrationTypes } from '../index'

const providers = listIntegrationTypes().map((type) => getIntegration(type)!)
describe('registry capability coverage', () => {
  it('contains registered providers', () => expect(providers.length).toBeGreaterThan(0))
  it.each(providers.map((definition) => [definition.id, definition] as const))(
    '%s declares a complete capability contract',
    (_id, provider) => {
      if (provider.inbound) {
        expect(provider.webhookRegistration).toBeTruthy()
        expect(provider.listExternalStatuses).toBeTypeOf('function')
        expect(provider.linkedItems).toBe(true)
      }
      if (provider.webhookRegistration) expect(provider.inbound).toBeTruthy()
      if (provider.hook || provider.userSync?.syncSegmentMembership)
        expect(provider.destination).toBeTruthy()
      if (provider.linkedItems) {
        expect(provider.hook || provider.issues?.create).toBeTruthy()
        expect(Object.keys(provider.destinations ?? {}).length).toBeGreaterThan(0)
      }
      for (const destination of Object.values(provider.destinations ?? {})) {
        expect(destination.list).toBeTypeOf('function')
        expect(destination.label).toBeTruthy()
        if (destination.childOf) expect(provider.destinations?.[destination.childOf]).toBeTruthy()
      }
      if (provider.appHooks) expect(provider.appHooks.execute).toBeTypeOf('function')
      if (provider.destination?.label)
        expect(
          provider.destination.label({ channelId: 'https://user:secret@example.test/path' })
        ).toBeNull()
    }
  )
})
