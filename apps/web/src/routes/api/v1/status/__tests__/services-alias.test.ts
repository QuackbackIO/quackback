/**
 * Status-component/service alias contract (STATUS-ADMIN-REDESIGN-SPEC.md §4
 * Phase 6 / §3 D4).
 *
 * The workspace's public wording is "service"; the REST API mirrors that at
 * `/status/services*` while `/status/components*` keeps working unchanged.
 * Both route families MUST delegate to the same shared handlers in
 * `-service-handlers.ts` so behavior stays byte-identical — this test
 * verifies the delegation via source contract rather than duplicating the
 * handler-behavior tests already covered elsewhere.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const statusDir = join(here, '..')

const componentsIndexSource = readFileSync(join(statusDir, 'components/index.ts'), 'utf-8')
const componentsIdSource = readFileSync(join(statusDir, 'components/$componentId.ts'), 'utf-8')
const servicesIndexSource = readFileSync(join(statusDir, 'services/index.ts'), 'utf-8')
const servicesIdSource = readFileSync(join(statusDir, 'services/$serviceId.ts'), 'utf-8')
const handlersSource = readFileSync(join(statusDir, '-service-handlers.ts'), 'utf-8')

/** Both route files import the same handler names from '../-service-handlers'. */
function importedHandlerNames(source: string): string[] {
  const match = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/-service-handlers['"]/)
  if (!match) return []
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
}

describe('status components/services alias', () => {
  it('components/index.ts and services/index.ts delegate to the same handlers', () => {
    const componentsHandlers = importedHandlerNames(componentsIndexSource)
    const servicesHandlers = importedHandlerNames(servicesIndexSource)

    expect(componentsHandlers).toEqual([
      'createStatusComponentHandler',
      'listStatusComponentsHandler',
    ])
    expect(servicesHandlers).toEqual(componentsHandlers)
  })

  it('components/$componentId.ts and services/$serviceId.ts delegate to the same handlers', () => {
    const componentsHandlers = importedHandlerNames(componentsIdSource)
    const servicesHandlers = importedHandlerNames(servicesIdSource)

    expect(componentsHandlers).toEqual(['getStatusComponentHandler', 'patchStatusComponentHandler'])
    expect(servicesHandlers).toEqual(componentsHandlers)
  })

  it('the services $serviceId route passes params.serviceId as the shared handler id', () => {
    expect(servicesIdSource).toMatch(/id:\s*params\.serviceId/)
    expect(componentsIdSource).toMatch(/id:\s*params\.componentId/)
  })

  it('neither route file duplicates handler logic (no withApiKeyAuth calls outside the shared module)', () => {
    for (const source of [
      componentsIndexSource,
      componentsIdSource,
      servicesIndexSource,
      servicesIdSource,
    ]) {
      expect(source).not.toContain('withApiKeyAuth')
    }
    expect(handlersSource).toContain('withApiKeyAuth')
  })

  it('the shared handlers module serializes with serializeStatusComponent (payload keys unchanged)', () => {
    expect(handlersSource).toContain('serializeStatusComponent')
    // D4 boundary: payload property names never change.
    expect(handlersSource).not.toMatch(/\bserviceId\s*:/)
  })
})
