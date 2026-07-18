import { describe, it, expect } from 'vitest'
import { ID_PREFIXES } from '@quackback/ids'
import { PERMISSION_CATEGORIES } from '@/lib/shared/permissions'
import { API_KEY_SCOPES } from '@/lib/shared/api-key-scopes'
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

  it('any catalogue-only event (beyond legacy EVENT_TYPES) follows <entity>.<verb> naming', () => {
    // WO-6 evolves this from a strict EVENT_TYPES bijection: new events emit
    // directly via emit() and never join the legacy union, so the catalogue is
    // allowed to be a SUPERSET of EVENT_TYPES. We still guard against typos by
    // requiring the dotted-lowercase naming convention.
    const legacy = new Set<string>(EVENT_TYPES)
    const catalogueOnly = catalogueTypes.filter((t) => !legacy.has(t))
    const malformed = catalogueOnly.filter((t) => !/^[a-z][a-z_]*\.[a-z][a-z_]*$/.test(t))
    expect(malformed).toEqual([])
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

  // ── events/CONTRACT.md enforcement ─────────────────────────────────────────

  /** Entities without a 1:1 TypeID (singletons / virtual aggregates). */
  const VIRTUAL_ENTITIES = new Set(['settings'])

  /** The fixed verb vocabulary. Generic lifecycle verbs + the curated semantic
   *  set. A new event with a novel verb must add it here on purpose — that is
   *  the guard against ad-hoc naming drift. */
  const VERBS = new Set<string>([
    // generic lifecycle
    'created',
    'updated',
    'deleted',
    'restored',
    'archived',
    // semantic (curated)
    'status_changed',
    'priority_changed',
    'assigned',
    'attribute_changed',
    'merged',
    'unmerged',
    'mentioned',
    'note_mentioned',
    'note_created',
    'note_added',
    'published',
    'replied',
    'handed_off',
    'csat_submitted',
    'csat_comment_added',
    'external_status_changed',
    'customer_unresponsive',
    'teammate_unresponsive',
    'approaching_breach',
    'breached',
    // status-page legacy compound verbs (entity is status_incident/status_component)
    'incident_created',
    'incident_updated',
    'maintenance_scheduled',
    'maintenance_started',
    'maintenance_completed',
    'component_changed',
  ])

  it('every entity is a @quackback/ids key (or an allowlisted virtual entity)', () => {
    const idKeys = new Set(Object.keys(ID_PREFIXES))
    const bad = allEventDefinitions()
      .map((d) => d.entity)
      .filter((e) => !idKeys.has(e) && !VIRTUAL_ENTITIES.has(e))
    expect(bad, `entity must match a TypeID key: ${[...new Set(bad)].join(', ')}`).toEqual([])
  })

  it('every category is a real PermissionCategory (shared auth spine)', () => {
    const cats = new Set<string>(PERMISSION_CATEGORIES)
    const bad = allEventDefinitions()
      .filter((d) => !cats.has(d.category))
      .map((d) => `${d.type}:${d.category}`)
    expect(bad).toEqual([])
  })

  it('every requiredScope is a real ApiKeyScope, derived from the category', () => {
    const scopes = new Set<string>(API_KEY_SCOPES)
    const bad = allEventDefinitions()
      .filter((d) => !scopes.has(d.requiredScope))
      .map((d) => `${d.type}:${d.requiredScope}`)
    expect(bad).toEqual([])
  })

  it('every event verb is in the fixed verb vocabulary', () => {
    const bad = catalogueTypes.filter((t) => !VERBS.has(t.split('.').slice(1).join('.')))
    expect(
      bad,
      `unknown verb — add to CONTRACT.md's verb list if intentional: ${bad.join(', ')}`
    ).toEqual([])
  })
})
