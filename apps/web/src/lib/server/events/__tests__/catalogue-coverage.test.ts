import { describe, it, expect } from 'vitest'
import { EVENT_TYPES } from '../types'
import { allEventDefinitions, getEventDefinition } from '../catalogue'

/**
 * WO-2 — the coverage gate. The catalogue must be BIJECTIVE with the legacy
 * `EVENT_TYPES` list: every dispatchable event type has exactly one catalogue
 * declaration and vice-versa. Adding a type to one and not the other turns this
 * red, which is the whole point — it makes "coverage by memory" a CI failure.
 */
describe('event catalogue coverage', () => {
  const catalogueTypes = allEventDefinitions().map((d) => d.type)

  it('has no duplicate declarations', () => {
    expect(new Set(catalogueTypes).size).toBe(catalogueTypes.length)
  })

  it('declares every EVENT_TYPES member (no missing catalogue entry)', () => {
    const declared = new Set(catalogueTypes)
    const missing = EVENT_TYPES.filter((t) => !declared.has(t))
    expect(missing).toEqual([])
  })

  it('declares nothing that is not an EVENT_TYPES member (no orphan catalogue entry)', () => {
    const legacy = new Set<string>(EVENT_TYPES)
    const orphan = catalogueTypes.filter((t) => !legacy.has(t))
    expect(orphan).toEqual([])
  })

  it('every declaration carries a complete exposure + scope + emits contract', () => {
    for (const def of allEventDefinitions()) {
      expect(def.entity).toBeTruthy()
      expect(def.requiredScope).toBeTruthy()
      expect(['always', 'never']).toContain(def.emits)
      expect(def.exposure).toMatchObject({
        webhook: expect.any(Boolean),
        workflow: expect.any(Boolean),
        audit: expect.any(Boolean),
      })
    }
  })

  it('getEventDefinition resolves a known type and misses an unknown one', () => {
    expect(getEventDefinition('post.status_changed')?.entity).toBe('post')
    expect(getEventDefinition('nope.not_real')).toBeUndefined()
  })
})
