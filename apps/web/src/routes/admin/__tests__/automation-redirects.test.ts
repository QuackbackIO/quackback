import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

type BeforeLoad = (ctx: Record<string, unknown>) => void

const MODULES = {
  '../automation.agent': () => import('../automation.agent'),
  '../automation.copilot': () => import('../automation.copilot'),
  '../automation.skills': () => import('../automation.skills'),
  '../automation.connectors': () => import('../automation.connectors'),
  '../automation.workflows': () => import('../automation.workflows'),
  '../automation.assistant': () => import('../automation.assistant'),
  '../automation.performance': () => import('../automation.performance'),
  '../settings.ai': () => import('../settings.ai'),
  '../automation.connectors_.$connectorId': () => import('../automation.connectors_.$connectorId'),
  '../automation_.workflows.$workflowId': () => import('../automation_.workflows.$workflowId'),
  '../automation.index': () => import('../automation.index'),
} as const

async function redirectOf(module: keyof typeof MODULES, ctx: Record<string, unknown>) {
  const { Route } = (await MODULES[module]()) as {
    Route: { options: { beforeLoad: BeforeLoad } }
  }
  try {
    Route.options.beforeLoad(ctx)
  } catch (thrown) {
    return (thrown as { options: { href?: string; to?: string } }).options
  }
  throw new Error(`${module} did not redirect`)
}

const at = (searchStr = '') => ({ location: { searchStr } })

describe('retired /admin/automation URLs', () => {
  it.each<[keyof typeof MODULES, string]>([
    ['../automation.agent', '/admin/settings/agent'],
    ['../automation.copilot', '/admin/settings/copilot'],
    ['../automation.skills', '/admin/settings/skills'],
    ['../automation.connectors', '/admin/settings/connectors'],
    ['../automation.workflows', '/admin/settings/workflows'],
    ['../automation.assistant', '/admin/settings/agent'],
    ['../automation.performance', '/admin/analytics'],
    ['../settings.ai', '/admin/settings/agent'],
  ])('%s lands on %s and keeps the query string', async (module, target) => {
    const withQuery = await redirectOf(module, at('?tab=guidance'))
    expect(withQuery.href).toBe(
      module === '../automation.performance'
        ? '/admin/analytics?section=ai'
        : `${target}?tab=guidance`
    )
    const bare = await redirectOf(module, at())
    expect(bare.href).toBe(
      module === '../automation.performance' ? '/admin/analytics?section=ai' : target
    )
  })

  it('moves a connector detail page and its OAuth result', async () => {
    const out = await redirectOf('../automation.connectors_.$connectorId', {
      ...at('?oauth=connected'),
      params: { connectorId: 'conn_1' },
    })
    expect(out.href).toBe('/admin/settings/connectors/conn_1?oauth=connected')
  })

  it('moves a workflow builder', async () => {
    const out = await redirectOf('../automation_.workflows.$workflowId', {
      ...at(),
      params: { workflowId: 'wf_1' },
    })
    expect(out.href).toBe('/admin/settings/workflows/wf_1')
  })

  it('sends the index to the first page the viewer can open', async () => {
    const ctx = (permissions: string[], supportInbox: boolean) => ({
      ...at(),
      context: { permissions, settings: { featureFlags: { supportInbox } } },
    })
    expect(
      (await redirectOf('../automation.index', ctx([PERMISSIONS.ASSISTANT_MANAGE], false))).href
    ).toBe('/admin/settings/agent')
    expect(
      (await redirectOf('../automation.index', ctx([PERMISSIONS.WORKFLOW_MANAGE], true))).href
    ).toBe('/admin/settings/workflows')
    expect(
      (await redirectOf('../automation.index', ctx([PERMISSIONS.WORKFLOW_MANAGE], false))).href
    ).toBe('/admin/settings')
  })
})
