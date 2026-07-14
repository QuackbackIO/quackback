/**
 * Status services/components OpenAPI contract (STATUS-ADMIN-REDESIGN-SPEC.md
 * §4 Phase 6 / §3 D4): `/status/services*` is the current public naming,
 * `/status/components*` keeps working but is marked deprecated.
 */
import { describe, expect, it } from 'vitest'
import '../schemas'
import { generateOpenAPISpec } from '../openapi'

describe('status services/components OpenAPI contract', () => {
  const spec = generateOpenAPISpec()

  it('registers the new /status/services paths', () => {
    expect(spec.paths).toHaveProperty('/status/services')
    expect(spec.paths).toHaveProperty('/status/services/{serviceId}')

    const collection = spec.paths?.['/status/services'] as Record<string, unknown>
    expect(collection).toHaveProperty('get')
    expect(collection).toHaveProperty('post')

    const detail = spec.paths?.['/status/services/{serviceId}'] as Record<string, unknown>
    expect(detail).toHaveProperty('get')
    expect(detail).toHaveProperty('patch')
  })

  it('keeps /status/components paths registered but marks them deprecated', () => {
    const collection = spec.paths?.['/status/components'] as Record<
      string,
      { deprecated?: boolean; description?: string }
    >
    const detail = spec.paths?.['/status/components/{componentId}'] as Record<
      string,
      { deprecated?: boolean; description?: string }
    >

    expect(collection.get?.deprecated).toBe(true)
    expect(collection.post?.deprecated).toBe(true)
    expect(detail.get?.deprecated).toBe(true)
    expect(detail.patch?.deprecated).toBe(true)

    // Deprecation description points readers at the replacement paths.
    expect(collection.get?.description).toContain('/status/services')
    expect(detail.patch?.description).toContain('/status/services')
  })

  it('does not mark the new /status/services paths deprecated', () => {
    const collection = spec.paths?.['/status/services'] as Record<string, { deprecated?: boolean }>
    const detail = spec.paths?.['/status/services/{serviceId}'] as Record<
      string,
      { deprecated?: boolean }
    >

    expect(collection.get?.deprecated).toBeUndefined()
    expect(collection.post?.deprecated).toBeUndefined()
    expect(detail.get?.deprecated).toBeUndefined()
    expect(detail.patch?.deprecated).toBeUndefined()
  })

  it('components and services share the same component schema (payload keys unchanged)', () => {
    const componentsBody = JSON.stringify(spec.paths?.['/status/components/{componentId}'])
    const servicesBody = JSON.stringify(spec.paths?.['/status/services/{serviceId}'])

    for (const key of ['groupId', 'segmentIds', 'showUptime']) {
      const inComponents = componentsBody.includes(key)
      const inServices = servicesBody.includes(key)
      expect(inComponents).toBe(inServices)
    }
  })
})
