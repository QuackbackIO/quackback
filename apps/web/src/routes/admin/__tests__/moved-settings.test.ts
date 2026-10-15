import { describe, expect, it } from 'vitest'

const aliases = [
  ['Agent', () => import('../settings.agent'), '/admin/settings/ai/customers'],
  ['Teammate AI', () => import('../settings.copilot'), '/admin/settings/ai/teammates'],
  ['Skills', () => import('../settings.skills'), '/admin/settings/ai/guidance'],
  ['Connectors', () => import('../settings.connectors'), '/admin/settings/ai/actions'],
  ['Office hours', () => import('../settings.office-hours'), '/admin/settings/hours-sla'],
  ['SLAs', () => import('../settings.sla'), '/admin/settings/hours-sla'],
  ['Ticket types', () => import('../settings.ticket-types'), '/admin/settings/tickets'],
  ['Ticket statuses', () => import('../settings.ticket-statuses'), '/admin/settings/tickets'],
  ['Conversation fields', () => import('../settings.conversation-data'), '/admin/settings/fields'],
  ['Developers', () => import('../settings.developers'), '/admin/settings/agents/keys'],
  ['MCP', () => import('../settings.mcp'), '/admin/settings/agents/assistants'],
] as const

async function target(load: () => Promise<unknown>, tab?: string) {
  const module = (await load()) as { Route: { options: { beforeLoad: (ctx: object) => unknown } } }
  try {
    await module.Route.options.beforeLoad({ search: { tab }, location: { searchStr: '?keep=yes' } })
  } catch (thrown) {
    const redirect = thrown as { options: { href: string; replace: boolean } }
    expect(redirect.options.replace).toBe(true)
    return new URL(redirect.options.href, 'https://acme.test')
  }
  throw new Error('A retired page did not redirect')
}

describe('moved settings bookmarks', () => {
  for (const [name, load, path] of aliases) {
    it(`${name} opens its new home and preserves other query parameters`, async () => {
      const url = await target(load)
      expect(url.pathname).toBe(path)
      expect(url.searchParams.get('keep')).toBe('yes')
    })
  }

  it.each(['knowledge', 'guidance'])(`preserves the audience of an old %s tab`, async (tab) => {
    for (const [load, audience] of [
      [() => import('../settings.agent'), 'customers'],
      [() => import('../settings.copilot'), 'teammates'],
    ] as const) {
      const url = await target(load, tab)
      expect(url.pathname).toBe(`/admin/settings/ai/${tab}`)
      expect(url.searchParams.get('tab')).toBe(audience)
      expect(url.searchParams.get('keep')).toBe('yes')
    }
  })

  it('keeps the old Developers tab selection', async () => {
    expect((await target(() => import('../settings.developers'), 'webhooks')).pathname).toBe(
      '/admin/settings/agents/webhooks'
    )
    expect((await target(() => import('../settings.developers'), 'mcp')).pathname).toBe(
      '/admin/settings/agents/assistants'
    )
  })
})
