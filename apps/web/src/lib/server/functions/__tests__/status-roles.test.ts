/**
 * Status-page server-fn permission contract.
 *
 * Incident lifecycle (create/update/post/delete/list/get) is contributor
 * territory (status_page.publish); reshaping the page (components, groups,
 * template CRUD, subscribers, settings) is admin territory
 * (status_page.manage). Template LISTING sits with publish, not manage:
 * the incident composer's template picker is used by contributors, so a
 * manage gate would 403 the create dialog for exactly the people it's for.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const fnSource = readFileSync(join(here, '..', 'status.ts'), 'utf-8')

function fnPermissionFor(fnName: string): string | null {
  const re = new RegExp(
    `export const ${fnName}\\s*=\\s*createServerFn[\\s\\S]*?requireAuth\\(\\{\\s*permission:\\s*PERMISSIONS\\.(\\w+)`
  )
  return fnSource.match(re)?.[1] ?? null
}

describe('status template permissions', () => {
  it('listStatusIncidentTemplatesFn gates on status_page.publish (composer picker)', () => {
    expect(fnPermissionFor('listStatusIncidentTemplatesFn')).toBe('STATUS_PAGE_PUBLISH')
  })

  it.each([
    ['createStatusIncidentTemplateFn'],
    ['updateStatusIncidentTemplateFn'],
    ['deleteStatusIncidentTemplateFn'],
  ])('%s stays on status_page.manage', (fnName) => {
    expect(fnPermissionFor(fnName)).toBe('STATUS_PAGE_MANAGE')
  })
})

describe('status incident permissions', () => {
  it.each([
    ['createStatusIncidentFn'],
    ['updateStatusIncidentFn'],
    ['postStatusIncidentUpdateFn'],
    ['listStatusIncidentsAdminFn'],
    // The overview + start-now are on-call surfaces: the floor permission of
    // anyone who can already run incidents, not workspace-admin manage.
    ['getStatusOverviewAdminFn'],
    ['startStatusMaintenanceNowFn'],
  ])('%s gates on status_page.publish', (fnName) => {
    expect(fnPermissionFor(fnName)).toBe('STATUS_PAGE_PUBLISH')
  })

  it('clearStatusHistoryFn stays on status_page.manage', () => {
    expect(fnPermissionFor('clearStatusHistoryFn')).toBe('STATUS_PAGE_MANAGE')
  })
})

describe('status subscriber permissions', () => {
  it.each([
    ['addStatusSubscriberFn'],
    ['importStatusSubscribersFn'],
    ['exportStatusSubscribersAdminFn'],
  ])('%s gates on status_page.manage (reshaping the page, not posting)', (fnName) => {
    expect(fnPermissionFor(fnName)).toBe('STATUS_PAGE_MANAGE')
  })
})
